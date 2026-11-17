import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import { defaultConfig } from "../../src/config/defaults";
import { ProviderConfigSchema } from "../../src/config/schema";
import type { Event, RunResult } from "../../src/core/types";
import { McpHttpServerConfigSchema } from "../../src/mcp/config";

const external = "mcp_local_echo";
type Reply = { name: string; args: unknown } | { text: string };
type Request = { model: string; tools?: Array<{ function: { name: string } }> };

function response(reply: Reply): Response {
  const delta =
    "name" in reply
      ? {
          tool_calls: [
            {
              index: 0,
              id: crypto.randomUUID(),
              function: { name: reply.name, arguments: JSON.stringify(reply.args) },
            },
          ],
        }
      : { content: reply.text };
  const chunk = {
    choices: [{ delta, finish_reason: "name" in reply ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 10 },
  };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-mcp-service-"));
  const replies: Reply[] = [];
  const requests: Request[] = [];
  const events: Event[] = [];
  const executed: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/mcp") {
        requests.push((await request.json()) as Request);
        const reply = replies.shift();
        if (!reply) throw new Error("Unexpected model request");
        return response(reply);
      }
      const message = (await request.json()) as {
        id?: number;
        method: string;
        params?: { arguments?: { text?: string } };
      };
      const rpc = (result: unknown) => Response.json({ jsonrpc: "2.0", id: message.id, result });
      switch (message.method) {
        case "initialize":
          return rpc({
            protocolVersion: "2026-07-28",
            capabilities: { tools: {} },
            serverInfo: { name: "discovery", version: "1.0.0" },
          });
        case "notifications/initialized":
          return new Response(null, { status: 202 });
        case "tools/list":
          return rpc({
            tools: ["echo", "other"].map((name) => ({
              name,
              description: `External ${name} tool`,
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
                additionalProperties: false,
              },
            })),
          });
        case "tools/call": {
          const text = message.params?.arguments?.text ?? "";
          executed.push(text);
          return rpc({ content: [{ type: "text", text: `Echo: ${text}` }] });
        }
        default:
          return new Response(null, { status: 404 });
      }
    },
  });
  const config = defaultConfig();
  config.conversation = { enabled: false };
  config.provider = "test";
  config.model = "first";
  config.providers = {
    test: ProviderConfigSchema.parse({
      protocol: "openai-chat",
      baseUrl: `${server.url.href}v1`,
      models: { first: {}, second: {} },
    }),
  };
  config.catalog.autoRefresh = false;
  config.skills = { sources: [] };
  if (config.checkpoints) config.checkpoints.shell = false;
  config.mcp.servers = {
    local: {
      ...McpHttpServerConfigSchema.parse({ url: `${server.url.href}mcp`, timeoutMs: 1000 }),
      env: {},
    },
  };
  await Bun.write(join(cwd, "flecten.config.json"), JSON.stringify(config));
  const service = await createAppService(cwd);
  service.session.subscribe((event) => events.push(event));
  await service.acceptTrust();
  return {
    service,
    replies,
    requests,
    events,
    executed,
    names: (index: number) => requests[index]?.tools?.map((tool) => tool.function.name) ?? [],
    finish: () => replies.push({ text: "<summary>Verified.</summary>" }),
    async close() {
      await service.dispose();
      server.stop(true);
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

test("the app discovers MCP tools per chat and preserves activation through refresh, replay and compaction", async () => {
  const f = await fixture();
  try {
    f.replies.push(
      { name: "tool_catalog", args: { operation: "list" } },
      { name: "tool_catalog", args: { operation: "activate", names: [external] } },
      { name: external, args: { text: "observed ".repeat(500) } },
    );
    f.finish();
    const first = (await f.service.session.send({
      type: "run",
      prompt: "Use external echo.",
    })) as RunResult;
    expect(first.stopReason).toBe("done");
    expect(f.names(0)).toContain("tool_catalog");
    expect(f.names(0)).not.toContain(external);
    expect(f.names(1)).not.toContain(external);
    expect(f.names(2)).toContain(external);
    expect(f.names(2)).not.toContain("mcp_local_other");
    expect(f.executed).toHaveLength(1);
    expect(f.replies).toHaveLength(0);
    expect(
      f.events.find(
        (event) => event.type === "tool.finished" && event.call.name === "tool_catalog",
      ),
    ).toMatchObject({ result: { ok: true, data: { total: 2 } } });

    await f.service.extensions.reconnect("local");
    await f.service.setModel({ sessionId: first.sessionId, provider: "test", model: "second" });
    const refreshIndex = f.requests.length;
    f.replies.push({ name: external, args: { text: "after refresh" } });
    f.finish();
    expect(
      await f.service.session.send({
        type: "run",
        sessionId: first.sessionId,
        prompt: "Continue.",
      }),
    ).toMatchObject({ stopReason: "done" });
    expect(f.requests[refreshIndex]?.model).toBe("second");
    expect(f.names(refreshIndex)).toContain(external);
    expect(f.replies).toHaveLength(0);

    const newIndex = f.requests.length;
    f.replies.push({ name: external, args: { text: "must stay inactive" } });
    expect(await f.service.session.send({ type: "run", prompt: "A new chat." })).toMatchObject({
      stopReason: "error",
    });
    expect(f.names(newIndex)).not.toContain(external);
    expect(f.executed).toHaveLength(2);
    expect(f.replies).toHaveLength(0);

    await f.service.session.close(first.sessionId);
    const replayIndex = f.requests.length;
    f.replies.push({ name: external, args: { text: "after replay" } });
    f.finish();
    expect(
      await f.service.session.send({ type: "run", sessionId: first.sessionId, prompt: "Reopen." }),
    ).toMatchObject({ stopReason: "done" });
    expect(f.names(replayIndex)).toContain(external);
    expect(f.events.filter((event) => event.type === "tool.finished").at(-1)).toMatchObject({
      call: { name: external, args: { text: "after replay" } },
      result: { ok: true },
    });
    expect(f.executed).toHaveLength(3);

    f.replies.push({
      text: JSON.stringify({
        progress: "Echo worked",
        locations: external,
        instructions: "Preserve request",
        nextSteps: "Continue",
        risks: "None",
      }),
    });
    expect(
      await f.service.session.send({ type: "context.compact", sessionId: first.sessionId }),
    ).toMatchObject({ compacted: true });
    expect(f.service.session.getHistory()[0]).toMatchObject({
      contextSummary: { activeMcpTools: [external] },
    });
    await f.service.session.close(first.sessionId);
    const compactIndex = f.requests.length;
    f.replies.push({ name: external, args: { text: "after compacted replay" } });
    f.finish();
    expect(
      await f.service.session.send({
        type: "run",
        sessionId: first.sessionId,
        prompt: "Continue compacted chat.",
      }),
    ).toMatchObject({ stopReason: "done" });
    expect(f.names(compactIndex)).toContain(external);
    expect(f.names(compactIndex)).not.toContain("mcp_local_other");
    expect(f.executed).toHaveLength(4);

    const draft = f.service.settings().config;
    if (!draft.permissions) throw new Error("Missing fixture permissions");
    draft.permissions.mcp = "deny";
    await f.service.saveSettings({ config: draft });
    f.replies.push({ name: external, args: { text: "must stay denied" } });
    f.finish();
    await f.service.session.send({
      type: "run",
      sessionId: first.sessionId,
      prompt: "Use the selected tool.",
    });
    expect(f.executed).toHaveLength(4);
    expect(f.events.filter((event) => event.type === "tool.finished").at(-1)).toMatchObject({
      result: { ok: false, data: { kind: "permission" } },
    });
    expect(f.replies).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 20_000);
