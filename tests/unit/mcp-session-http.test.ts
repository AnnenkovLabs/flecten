import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMcpServerConfig } from "../../src/mcp/config";
import { InMemoryTokenProvider } from "../../src/mcp/oauth";
import { renderMcpCatalogs } from "../../src/mcp/prompt";
import { connectMcpServers } from "../../src/mcp/session";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

const dirs: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-mcp-http-"));
  dirs.push(dir);
  return dir;
}

function context(cwd: string): ToolContext {
  return {
    sessionId: "s_test",
    cwd,
    signal: new AbortController().signal,
    logDir: join(cwd, ".liquid/logs"),
    limits,
    reads: new ReadTracker(),
  };
}

function startServer(
  fetch: (request: Request) => Response | Promise<Response>,
): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({ port: 0, fetch });
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function jsonResult(
  id: number | string | undefined,
  result: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "content-type": "application/json", ...headers },
  });
}

function sse(messages: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const message of messages) {
          controller.enqueue(
            encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`),
          );
        }
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function initializeResult(message: RpcRequest, instructions = "Use echo remotely."): Response {
  return jsonResult(
    message.id,
    {
      protocolVersion: "2026-07-28",
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: "fake-http", version: "1.0.0" },
      instructions,
    },
    { "mcp-session-id": "session-http" },
  );
}

async function rpc(request: Request): Promise<RpcRequest> {
  return (await request.json()) as RpcRequest;
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("condition was not met in time");
    await Bun.sleep(5);
  }
}

const echoTool = {
  name: "echo",
  title: "Echo",
  description: "Return the supplied text",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
};

describe("MCP session over Streamable HTTP", () => {
  test("connects, exposes tools and catalogs, reads resources and prompts", async () => {
    let resources = [{ uri: "file:///a", name: "A", mimeType: "text/plain", description: "Alpha" }];
    const authHeaders: Array<string | null> = [];

    const server = startServer(async (request) => {
      authHeaders.push(request.headers.get("authorization"));
      const message = await rpc(request);
      switch (message.method) {
        case "initialize":
          return initializeResult(message);
        case "notifications/initialized":
          return new Response(null, { status: 202 });
        case "tools/list":
          return jsonResult(message.id, { tools: [echoTool] });
        case "tools/call": {
          const args = message.params?.arguments as { text?: string } | undefined;
          return jsonResult(message.id, {
            content: [{ type: "text", text: `echo: ${args?.text ?? ""}` }],
            structuredContent: { text: args?.text ?? "" },
            isError: false,
          });
        }
        case "resources/list":
          return jsonResult(message.id, { resources });
        case "resources/templates/list":
          return jsonResult(message.id, { resourceTemplates: [] });
        case "resources/read": {
          const uri = String(message.params?.uri);
          if (uri === "file:///notify") {
            resources = [
              ...resources,
              { uri: "file:///b", name: "B", mimeType: "text/plain", description: "Beta" },
            ];
            return sse([
              { jsonrpc: "2.0", method: "notifications/resources/list_changed" },
              {
                jsonrpc: "2.0",
                id: message.id,
                result: { contents: [{ uri, mimeType: "text/plain", text: "changed" }] },
              },
            ]);
          }
          return jsonResult(message.id, {
            contents: [{ uri, mimeType: "text/plain", text: "hello" }],
          });
        }
        case "prompts/list":
          return jsonResult(message.id, {
            prompts: [
              {
                name: "greet",
                description: "Greeting prompt",
                arguments: [{ name: "name", required: true }],
              },
            ],
          });
        case "prompts/get": {
          const args = message.params?.arguments as { name?: string } | undefined;
          return jsonResult(message.id, {
            description: "Greeting prompt",
            messages: [
              { role: "user", content: { type: "text", text: `Hello ${args?.name ?? ""}` } },
            ],
          });
        }
        default:
          return new Response("not found", { status: 404 });
      }
    });

    const cwd = await tempDir();
    const provider = new InMemoryTokenProvider({ token: "secret" });
    const runtime = await connectMcpServers(
      {
        remote: parseMcpServerConfig({ url: server.url.toString() }),
      },
      cwd,
      { tokenProvider: provider, catalogBudgetChars: 2000 },
    );

    try {
      expect(authHeaders[0]).toBe("Bearer secret");
      expect(runtime.statuses).toMatchObject([
        {
          id: "remote",
          state: "ready",
          tools: 3,
          available: 1,
          protocol: "2026-07-28",
          resources: 1,
          prompts: 1,
        },
      ]);
      expect(runtime.tools.map((tool) => tool.name)).toEqual([
        "mcp_remote_echo",
        "mcp_remote_read_resource",
        "mcp_remote_use_prompt",
      ]);
      expect(runtime.instructions[0]?.text).toContain("Use echo remotely.");
      expect(runtime.instructions[0]?.text).toContain("# MCP catalogs");
      expect(runtime.instructions[0]?.text).toContain("file:///a");
      expect(runtime.instructions[0]?.text).toContain("greet");

      const echo = runtime.tools[0];
      expect(echo).toBeDefined();
      if (!echo) throw new Error("echo tool was not exposed");
      const result = await echo.execute({ text: "hi" }, context(cwd));
      expect(result.ok).toBe(true);
      expect(result.output).toContain("echo: hi");

      const catalogs = runtime.catalogs?.[0];
      expect(catalogs).toBeDefined();
      if (!catalogs) throw new Error("catalogs were not exposed");

      expect(catalogs.resourceItems.map((resource) => resource.uri)).toEqual(["file:///a"]);
      expect(catalogs.promptItems.map((prompt) => prompt.name)).toEqual(["greet"]);

      const contents = await catalogs.resources.readResource("file:///a");
      expect(contents).toEqual([
        { kind: "text", uri: "file:///a", mimeType: "text/plain", text: "hello" },
      ]);
      const prompt = await catalogs.prompts.getPrompt("greet", { name: "Sasha" });
      expect(prompt.messages[0]).toEqual({
        role: "user",
        content: { type: "text", text: "Hello Sasha" },
      });

      const changed = await catalogs.resources.readResource("file:///notify");
      expect(changed[0]).toMatchObject({ kind: "text", text: "changed" });
      await waitFor(() => runtime.catalogs?.[0]?.resourceItems.length === 2);
      expect(runtime.statuses[0]?.resources).toBe(2);
      expect(catalogs.resourceItems.map((resource) => resource.uri)).toEqual([
        "file:///a",
        "file:///b",
      ]);
    } finally {
      await runtime.close();
    }
  });

  test("degrades after a failed connect and recovers through health retries", async () => {
    let failures = 1;
    const server = startServer(async (request) => {
      const message = await rpc(request);
      switch (message.method) {
        case "initialize":
          if (failures > 0) {
            failures -= 1;
            return new Response("warming up", { status: 503 });
          }
          return initializeResult(message, "Recovered server.");
        case "notifications/initialized":
          return new Response(null, { status: 202 });
        case "tools/list":
          return jsonResult(message.id, { tools: [echoTool] });
        case "tools/call":
          return jsonResult(message.id, {
            content: [{ type: "text", text: "echo: after recovery" }],
            isError: false,
          });
        default:
          return new Response("not found", { status: 404 });
      }
    });

    const cwd = await tempDir();
    const runtime = await connectMcpServers(
      { remote: parseMcpServerConfig({ url: server.url.toString() }) },
      cwd,
      { health: { baseDelayMs: 250, maxDelayMs: 250, maxAttempts: 5 } },
    );

    try {
      const degraded = runtime.statuses[0];
      expect(degraded?.state).toBe("degraded");
      expect(degraded?.tools).toBe(0);
      expect(degraded?.lastError?.length).toBeGreaterThan(0);
      expect(degraded?.error?.length).toBeGreaterThan(0);
      expect(degraded?.nextRetryAt).toBeGreaterThan(Date.now());
      expect(runtime.tools).toHaveLength(0);

      await waitFor(() => runtime.statuses[0]?.state === "ready");
      expect(runtime.statuses[0]?.tools).toBe(1);
      expect(runtime.statuses[0]?.error).toBeUndefined();
      expect(runtime.statuses[0]?.lastError).toBeUndefined();
      expect(runtime.statuses[0]?.nextRetryAt).toBeUndefined();
      expect(runtime.tools.map((tool) => tool.name)).toEqual(["mcp_remote_echo"]);

      const echo = runtime.tools[0];
      if (!echo) throw new Error("recovered tool was not exposed");
      const result = await echo.execute({ text: "after recovery" }, context(cwd));
      expect(result.ok).toBe(true);
      expect(result.output).toContain("echo: after recovery");
    } finally {
      await runtime.close();
    }
  });
});

describe("MCP catalog prompt budget", () => {
  test("renders a compact catalog and stops at the caller budget", () => {
    const resources = Array.from({ length: 20 }, (_, index) => ({
      uri: `file:///${index}`,
      name: `Resource ${index}`,
      description: "x".repeat(240),
    }));
    const prompts = Array.from({ length: 10 }, (_, index) => ({
      name: `prompt-${index}`,
      description: "y".repeat(240),
      arguments: [{ name: "value", required: true }],
    }));

    const text = renderMcpCatalogs([{ server: "docs", resources, prompts }], 800);
    expect(text).toBeDefined();
    expect(text?.length).toBeLessThanOrEqual(800);
    expect(text).toContain("# MCP catalogs");
    expect(text).toContain("- Trust: `untrusted`");
    expect(text).toContain("### Resource");
    expect(text).toContain("file:///0");
    expect(text).not.toContain("file:///19");
    expect(renderMcpCatalogs([], 100)).toBeUndefined();
  });
});
