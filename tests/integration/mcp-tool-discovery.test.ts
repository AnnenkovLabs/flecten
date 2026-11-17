import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppExtensions, registryFor } from "../../src/app/extensions";
import { sessionModelTools } from "../../src/app/session-model-options";
import { HarnessConfigSchema } from "../../src/config/schema";
import { createSession, type SessionOptions } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import { McpStdioServerConfigSchema } from "../../src/mcp/config";
import { createMcpTool } from "../../src/mcp/tools";
import { PermissionEngine } from "../../src/security/permissions";
import { replayMessages } from "../../src/store/events/replay";
import { pageSink } from "../../src/store/pages";
import { sessionPaths } from "../../src/store/paths";
import type { Tool } from "../../src/tools/types";
import { scriptedProvider } from "../helpers/fake-provider";

const name = "mcp_local_echo";
const other = "mcp_local_other";
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 1000,
  readLimitLines: 100,
};
const call = (id: string, tool: string, args: unknown) => [
  { type: "tool_call" as const, id, name: tool, args },
  { type: "done" as const, reason: "tool_use" as const },
];
const end = [
  { type: "text" as const, delta: "<summary>Verified.</summary>" },
  { type: "done" as const, reason: "end" as const },
];

function extensions(tools: Tool[]): AppExtensions {
  return {
    tools,
    sections: [],
    skills: { skills: [], diagnostics: [] },
    mcp: { tools, instructions: [], statuses: [], close: async () => {} },
    dispose: async () => {},
  };
}

test("production MCP discovery exposes activated schemas and restores selection through compaction, restart and model update", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-discovery-"));
  let calls = 0;
  const external = (toolName: string) =>
    createMcpTool(
      "local",
      McpStdioServerConfigSchema.parse({ command: "unused-fixture" }),
      {
        async callTool(_name, args) {
          calls++;
          return { content: [{ type: "text", text: `Observed ${args.value}` }] };
        },
      },
      {
        name: toolName,
        description: "Echo an observed value.",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
      toolName,
    );
  const first = external(name);
  const second = external(other);
  if (!first || !second) throw new Error("Invalid fixture tool");
  const config = HarnessConfigSchema.parse({ useDefaults: false });
  const tools = () => registryFor(() => extensions([first, second]), config);
  const provider = scriptedProvider([
    call("premature", name, { value: "premature" }),
    call("list", "tool_catalog", { operation: "list" }),
    call("bad-selection", "tool_catalog", { operation: "activate", names: [name, "mcp_unknown"] }),
    call("selection", "tool_catalog", { operation: "activate", names: [name] }),
    call("invalid-args", name, { value: 42 }),
    call("observed", name, { value: "first result" }),
    end,
    end,
    [
      {
        type: "text",
        delta: JSON.stringify({
          progress: "Echo observed",
          locations: "mcp_local_echo",
          instructions: "Preserve request",
          nextSteps: "Continue",
          risks: "none",
        }),
      },
      { type: "done", reason: "end" },
    ],
  ]);
  const permissions = new PermissionEngine({
    rules: [
      { action: "mcp", policy: "allow" },
      { action: "read", policy: "allow" },
    ],
  });
  const events: Event[] = [];
  const options: SessionOptions = {
    cwd,
    provider,
    providerId: "scripted",
    model: provider.model,
    tools: sessionModelTools(config, tools()),
    system: "Use explicit tool discovery.",
    limits,
    maxOutputTokens: 1000,
    context: { window: 100_000, reserve: 1000 },
    loop: { maxTurns: 10, continuations: 0, parallelTools: false },
    permissions,
    pages: (id) => pageSink(sessionPaths(cwd, id)),
    logDir: (id) => sessionPaths(cwd, id).logs,
  };
  const session = createSession(options);
  session.subscribe((event) => events.push(event));
  let restarted: ReturnType<typeof createSession> | undefined;
  let isolated: ReturnType<typeof createSession> | undefined;
  try {
    const result = (await session.send({
      type: "run",
      sessionId: "s_discovery",
      prompt: "Inspect and execute the echo capability.",
    })) as RunResult;
    expect(result.stopReason).toBe("done");
    expect(calls).toBe(1);
    const names = (index: number) => provider.requests[index]?.tools.map((tool) => tool.name) ?? [];
    expect(names(0)).toContain("tool_catalog");
    expect(names(0)).not.toContain(name);
    expect(names(3)).not.toContain(name);
    expect(names(4)).toContain(name);
    expect(names(4)).not.toContain(other);
    expect(
      events.find((event) => event.type === "tool.finished" && event.call.id === "bad-selection"),
    ).toMatchObject({ result: { ok: false } });
    expect(
      events.find((event) => event.type === "tool.finished" && event.call.id === "invalid-args"),
    ).toMatchObject({ result: { ok: false } });
    await session.send({
      type: "run",
      sessionId: "s_discovery",
      prompt: "Keep the verified outcome available.",
    });
    expect(await session.send({ type: "context.compact" })).toMatchObject({ compacted: true });
    const restored = replayMessages(
      events.map((event, index) => ({ seq: index + 1, event })),
    ).messages;
    expect(restored[0]?.role === "user" && restored[0].contextSummary?.activeMcpTools).toEqual([
      name,
    ]);
    await session.dispose();
    const afterRestart = scriptedProvider([
      call("restored-call", name, { value: "restored result" }),
      end,
    ]);
    restarted = createSession({
      ...options,
      provider: afterRestart,
      tools: sessionModelTools(config, tools()),
      loadHistory: async () => structuredClone(restored),
    });
    expect(
      await restarted.send({
        type: "run",
        sessionId: "s_discovery",
        prompt: "Continue the selected capability.",
      }),
    ).toMatchObject({ stopReason: "done" });
    expect(afterRestart.requests[0]?.tools.map((tool) => tool.name)).toContain(name);
    expect(afterRestart.requests[0]?.tools.map((tool) => tool.name)).not.toContain(other);
    expect(calls).toBe(2);
    const deniedProvider = scriptedProvider([
      call("denied-call", name, { value: "must not execute" }),
      end,
    ]);
    restarted.update({
      provider: deniedProvider,
      tools: sessionModelTools(config, tools()),
      permissions: new PermissionEngine({ rules: [{ action: "mcp", policy: "deny" }] }),
    });
    await restarted.send({
      type: "run",
      sessionId: "s_discovery",
      prompt: "Try under updated permissions.",
    });
    expect(deniedProvider.requests[0]?.tools.map((tool) => tool.name)).toContain(name);
    expect(calls).toBe(2);
    const separate = scriptedProvider([
      call("isolated-call", name, { value: "must stay inactive" }),
      end,
    ]);
    isolated = createSession({ ...options, provider: separate });
    await isolated.send({ type: "run", sessionId: "s_other", prompt: "A different chat." });
    expect(separate.requests[0]?.tools.map((tool) => tool.name)).not.toContain(name);
    expect(calls).toBe(2);
  } finally {
    await restarted?.dispose();
    await isolated?.dispose();
    await session.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
