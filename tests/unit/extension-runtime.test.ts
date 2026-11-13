import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import { createAppService } from "../../src/app/service";
import { defaultConfig } from "../../src/config/defaults";
import { ProviderConfigSchema } from "../../src/config/schema";
import { McpHttpServerConfigSchema } from "../../src/mcp/config";
import type { McpSecureStore } from "../../src/mcp/oauth";
import { McpOAuthClient } from "../../src/mcp/oauth-client";

const dirs: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function rpc(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-extension-runtime-"));
  dirs.push(cwd);
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const message = (await request.json()) as { id?: number; method: string };
      switch (message.method) {
        case "initialize":
          return rpc(message.id, {
            protocolVersion: "2026-07-28",
            capabilities: { tools: {}, resources: {}, prompts: {} },
          });
        case "notifications/initialized":
          return new Response(null, { status: 202 });
        case "tools/list":
          return rpc(message.id, {
            tools: [{ name: "search", inputSchema: { type: "object", properties: {} } }],
          });
        case "resources/list":
          return rpc(message.id, { resources: [{ name: "Guide", uri: "docs://guide" }] });
        case "resources/templates/list":
          return rpc(message.id, { resourceTemplates: [] });
        case "resources/read":
          return rpc(message.id, { contents: [{ uri: "docs://guide", text: "MCP source text" }] });
        case "prompts/list":
          return rpc(message.id, { prompts: [{ name: "review", description: "Review changes" }] });
        case "prompts/get":
          return rpc(message.id, {
            messages: [{ role: "user", content: { type: "text", text: "Review the changes" } }],
          });
        default:
          return new Response("not found", { status: 404 });
      }
    },
  });
  servers.push(server);
  const config = defaultConfig();
  config.conversation = { enabled: false };
  config.catalog.autoRefresh = false;
  config.skills = { sources: ["project-liquid"] };
  config.mcp.servers = {
    docs: {
      ...McpHttpServerConfigSchema.parse({ url: server.url.href, timeoutMs: 1000 }),
      env: {},
    },
  };
  await Bun.write(join(cwd, "flecten.config.json"), JSON.stringify(config));
  return { cwd, service: await createAppService(cwd) };
}

test("runtime commands expose MCP health, catalogs, reconnect and safe context through the real service", async () => {
  const { service } = await setup();
  try {
    expect(service.extensions.status().servers).toEqual([]);
    await service.acceptTrust();
    const handlers = createHandlers(service, () => undefined);
    const status = await handlers["mcp.status"]({ type: "mcp.status" });
    expect(status).toMatchObject({
      mcp: {
        servers: [{ id: "docs", state: "ready" }],
        catalogs: [{ server: "docs", resources: [{ uri: "docs://guide" }] }],
      },
    });
    expect(
      (
        await handlers["mcp.resource"]({
          type: "mcp.resource",
          server: "docs",
          uri: "docs://guide",
        })
      )?.attachedContext,
    ).toMatchObject({ untrusted: true, kind: "resource" });
    expect(
      (await handlers["mcp.prompt"]({ type: "mcp.prompt", server: "docs", name: "review" }))
        ?.attachedContext,
    ).toMatchObject({ kind: "prompt" });
    expect(await handlers["mcp.reconnect"]({ type: "mcp.reconnect", id: "docs" })).toMatchObject({
      mcp: { servers: [{ state: "ready" }] },
    });
    const draft = service.settings().config;
    const docs = draft.mcp.servers.docs;
    if (!docs) throw new Error("missing docs server");
    docs.enabled = false;
    await service.saveSettings({ config: draft });
    expect(service.extensions.status().servers).toEqual([]);
  } finally {
    await service.dispose();
  }
});

test("skills added on disk appear in the command menu and model prefix without restart", async () => {
  const { cwd, service } = await setup();
  try {
    await service.acceptTrust();
    const before = service.info().system.hash;
    const path = join(cwd, ".liquid/skills/live");
    await mkdir(path, { recursive: true });
    await Bun.write(
      join(path, "SKILL.md"),
      "---\nname: live\ndescription: Live helper\nversion: 2\n---\nFollow these instructions.",
    );
    expect(await service.listCommands()).toContainEqual({
      name: "live",
      description: "Live helper",
      source: "skill",
    });
    expect(service.info().system.hash).not.toBe(before);
    expect(await service.reloadSkills()).toMatchObject([
      { name: "live", version: "2", resources: [] },
    ]);
  } finally {
    await service.dispose();
  }
});

test("SDK OAuth provides PKCE consent and a state-checked loopback callback without exposing credentials", async () => {
  const values = new Map<string, string>();
  const store: McpSecureStore = {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    delete: (key) => {
      values.delete(key);
    },
  };
  let base = "";
  let tokenRequests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.includes("oauth-protected-resource"))
        return Response.json({ resource: `${base}/mcp`, authorization_servers: [base] });
      if (path.includes("oauth-authorization-server"))
        return Response.json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          code_challenge_methods_supported: ["S256"],
          response_types_supported: ["code"],
        });
      if (path === "/token") {
        tokenRequests += 1;
        const form = await request.formData();
        expect(form.get("code_verifier")).toBeTruthy();
        return Response.json({
          access_token: "test-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      return new Response(null, { status: 404 });
    },
  });
  servers.push(server);
  base = server.url.href.slice(0, -1);
  let connected = 0;
  const client = new McpOAuthClient(
    "test",
    McpHttpServerConfigSchema.parse({
      url: `${base}/mcp`,
      oauth: { clientId: "registered-client", scopes: ["read"] },
    }),
    store,
    async () => {
      connected += 1;
    },
  );
  try {
    const result = await client.start();
    expect(result.state).toBe("pending");
    expect(JSON.stringify(result)).not.toContain("test-access-token");
    const url = new URL(result.url ?? "");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
    callback.searchParams.set("code", "test-code");
    callback.searchParams.set("state", "wrong");
    expect((await fetch(callback)).status).toBe(400);
    expect(tokenRequests).toBe(0);
    callback.searchParams.set("state", url.searchParams.get("state") ?? "");
    const done = await fetch(callback);
    expect(await done.text()).toContain("Authorization complete");
    expect(connected).toBe(1);
    expect(await client.getToken()).toBe("test-access-token");
    expect(tokenRequests).toBe(1);
  } finally {
    client.cancel();
  }
});

test("HTTP server elicitation reaches UI commands and validates the answer before resolving the tool", async () => {
  let original: ReadableStreamDefaultController<Uint8Array> | undefined;
  let originalId: unknown;
  const encoder = new TextEncoder();
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const message = (await request.json()) as { id?: unknown; method?: string; result?: unknown };
      if (message.method === "initialize")
        return rpc(message.id, { protocolVersion: "2026-07-28", capabilities: { tools: {} } });
      if (message.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      if (message.method === "tools/list")
        return rpc(message.id, {
          tools: [{ name: "question", inputSchema: { type: "object", properties: {} } }],
        });
      if (message.method === "tools/call") {
        originalId = message.id;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              original = controller;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ jsonrpc: "2.0", id: "form-1", method: "elicitation/create", params: { message: "Choose a project", requestedSchema: { type: "object", properties: { project: { type: "string", enum: ["alpha", "beta"] } }, required: ["project"] } } })}\n\n`,
                ),
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      if (message.id === "form-1") {
        original?.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ jsonrpc: "2.0", id: originalId, result: { content: [{ type: "text", text: "selected" }] } })}\n\n`,
          ),
        );
        original?.close();
        return new Response(null, { status: 202 });
      }
      return new Response(null, { status: 404 });
    },
  });
  servers.push(server);
  const cwd = await mkdtemp(join(tmpdir(), "liquid-elicitation-path-"));
  dirs.push(cwd);
  const { connectMcpServers } = await import("../../src/mcp/session");
  const { McpElicitationBroker } = await import("../../src/mcp/elicitation");
  const { ToolRegistry } = await import("../../src/tools/registry");
  const { ReadTracker } = await import("../../src/tools/util/read-tracker");
  const broker = new McpElicitationBroker();
  const runtime = await connectMcpServers(
    { docs: McpHttpServerConfigSchema.parse({ url: server.url.href, timeoutMs: 5000 }) },
    cwd,
    { elicitation: broker, health: { maxAttempts: 1 } },
  );
  try {
    const limits = {
      maxOutputBytes: 10000,
      maxOutputLines: 1000,
      bashTimeoutMs: 5000,
      readLimitLines: 1000,
    };
    const registry = new ToolRegistry(runtime.tools, { limits });
    const name = runtime.tools.find((tool) => tool.name.endsWith("_question"))?.name ?? "";
    const result = registry.run(
      { id: "question-1", name, args: {} },
      {
        cwd,
        sessionId: "test",
        signal: AbortSignal.timeout(5000),
        logDir: cwd,
        limits,
        reads: new ReadTracker(),
      },
    );
    for (let attempt = 0; broker.pending().length === 0 && attempt < 100; attempt += 1)
      await Bun.sleep(5);
    const request = broker.pending()[0];
    if (!request) throw new Error("elicitation did not reach the broker");
    expect(request.server).toBe("docs");
    expect(() =>
      broker.answer(request.id, { action: "accept", content: { project: "unknown" } }),
    ).toThrow("does not match");
    expect(broker.pending()).toHaveLength(1);
    expect(broker.answer(request.id, { action: "accept", content: { project: "alpha" } })).toBe(
      true,
    );
    expect((await result).output).toContain("selected");
  } finally {
    await runtime.close();
    broker.close();
  }
});

test("project subagent definitions require trust and appear in real model tool metadata", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-subagents-product-"));
  dirs.push(cwd);
  const agents = join(cwd, ".liquid/agents");
  await mkdir(agents, { recursive: true });
  await Bun.write(
    join(agents, "auditor.json"),
    JSON.stringify({
      name: "auditor",
      description: "Inspect the parser",
      systemPrompt: "Read the parser",
      allowedTools: ["read"],
      permissions: [{ action: "read", policy: "allow" }],
      model: "child-model",
      budget: { maxTokens: 400, maxTurns: 2 },
    }),
  );
  let childModel = "";
  let roleVisible = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const input = (await request.json()) as {
        model: string;
        tools: Array<{ function: { description: string } }>;
      };
      if (input.model === "child-model") childModel = input.model;
      else
        roleVisible = input.tools.some((tool) =>
          tool.function.description.includes('"id": "auditor"'),
        );
      const text = input.model === "child-model" ? '{"summary":"parser inspected"}' : "done";
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  servers.push(server);
  const config = defaultConfig();
  config.conversation = { enabled: false };
  config.provider = "test";
  config.model = "parent-model";
  config.providers = {
    test: ProviderConfigSchema.parse({
      protocol: "openai-chat",
      baseUrl: server.url.href,
      headers: {},
      models: { "parent-model": {}, "child-model": {} },
    }),
  };
  config.catalog.autoRefresh = false;
  config.skills = { sources: [] };
  await Bun.write(join(cwd, "flecten.config.json"), JSON.stringify(config));
  const service = await createAppService(cwd);
  try {
    expect(service.info().trustRequired).toBe(true);
    expect(service.info().trustAccepted).toBe(false);
    await service.acceptTrust();
    await service.session.send({ type: "run", prompt: "hello" });
    expect(roleVisible).toBe(true);
    const { subagentChildRunner } = await import("../../src/app/subagent-child");
    const { CheckpointStore } = await import("../../src/store/checkpoints");
    const { ToolRegistry } = await import("../../src/tools/registry");
    const { z } = await import("zod");
    const checkpoints = new CheckpointStore({ cwd });
    await checkpoints.init();
    const child = subagentChildRunner({
      cwd,
      config: () => config,
      provider: () => {
        throw new Error("must build adapter for model override");
      },
      tools: () => new ToolRegistry([], { limits: config.tools }),
      trusted: () => true,
      checkpoints,
      sandbox: () => undefined,
      osSandbox: () => undefined,
      shellCheckpoints: () => undefined,
    });
    const spec = {
      id: "auditor",
      name: "auditor",
      description: "inspect",
      systemPrompt: "inspect",
      allowedTools: [],
      permissions: [],
      model: "child-model",
      budget: { maxTokens: 400, maxTurns: 2 },
      resultSchema: z.unknown(),
    };
    const result = await child({
      spec,
      systemPrompt: "inspect",
      messages: [{ role: "user", content: "inspect" }],
      allowedTools: [],
      permissions: [],
      budget: spec.budget,
      signal: AbortSignal.timeout(5000),
    });
    expect(result.error).toBeUndefined();
    expect(childModel).toBe("child-model");
    expect(result.text).toContain("parser inspected");
  } finally {
    await service.dispose();
  }
});
