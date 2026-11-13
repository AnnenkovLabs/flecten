import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "../../src/config/schema";
import { McpElicitationBroker, McpElicitationError } from "../../src/mcp/elicitation";
import { connectMcpServers } from "../../src/mcp/session";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-mcp-elicit-"));
  dirs.push(dir);
  return dir;
}

function serverConfig(env: Record<string, string> = {}): McpServerConfig {
  return {
    command: process.execPath,
    args: [join(import.meta.dir, "..", "fixtures", "mcp-stdio-server.ts")],
    env,
    enabled: true,
    protocol: "legacy",
    timeoutMs: 5000,
    maxTools: 64,
  };
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

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("condition was not met in time");
    await Bun.sleep(10);
  }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const form = {
  message: "What is your name?",
  requestedSchema: {
    type: "object" as const,
    properties: { name: { type: "string" } },
    required: ["name"],
  },
};

describe("MCP elicitation broker", () => {
  test("exposes pending requests and validates answers", async () => {
    const broker = new McpElicitationBroker({ now: () => 100 });
    const pending = broker.request("docs", form);
    expect(broker.pending()).toEqual([
      {
        id: "elicit_1",
        server: "docs",
        createdAt: 100,
        mode: "form",
        ...form,
      },
    ]);
    expect(() => broker.answer("elicit_1", { action: "maybe" })).toThrow(McpElicitationError);
    expect(broker.answer("elicit_1", { action: "accept", content: { name: "Sasha" } })).toBe(true);
    await expect(pending).resolves.toEqual({ action: "accept", content: { name: "Sasha" } });
    expect(broker.pending()).toEqual([]);
    broker.close();
  });

  test("cancels pending work without blocking unrelated requests", async () => {
    const broker = new McpElicitationBroker();
    const first = broker.request("docs", form);
    const second = broker.request("other", form);
    expect(broker.pending()).toHaveLength(2);
    expect(broker.cancel("elicit_1")).toBe(true);
    await expect(first).resolves.toEqual({ action: "cancel" });
    expect(broker.answer("elicit_2", { action: "decline" })).toBe(true);
    await expect(second).resolves.toEqual({ action: "decline" });

    const controller = new AbortController();
    const aborted = broker.request("docs", form, controller.signal);
    controller.abort();
    await expect(aborted).resolves.toEqual({ action: "cancel" });
    broker.close();
  });

  test("rejects invalid requests and enforces the pending limit", async () => {
    const broker = new McpElicitationBroker({ maxPending: 1 });
    await expect(broker.request("docs", { message: "" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    const pending = broker.request("docs", form);
    await expect(broker.request("docs", form)).rejects.toMatchObject({
      code: "too_many_pending",
    });
    broker.cancel("elicit_1");
    await pending;
    broker.close();
  });
});

describe("MCP elicitation over stdio", () => {
  test("answers a server request through the UI broker without blocking other tools", async () => {
    const cwd = await tempDir();
    const runtime = await connectMcpServers({ local: serverConfig({ MCP_TEST_ELICIT: "1" }) }, cwd);
    try {
      const ask = runtime.tools.find((tool) => tool.name === "mcp_local_ask");
      const echo = runtime.tools.find((tool) => tool.name === "mcp_local_echo");
      expect(ask).toBeDefined();
      expect(echo).toBeDefined();
      if (!ask || !echo) throw new Error("fixture tools were not exposed");

      const pending = ask.execute({}, context(cwd));
      await waitFor(() => runtime.elicitation.pending().length === 1);
      const [request] = runtime.elicitation.pending();
      expect(request).toMatchObject({
        server: "local",
        mode: "form",
        message: "What is your name?",
      });
      expect(request?.requestedSchema?.properties).toHaveProperty("name");

      const unrelated = await echo.execute({ text: "still works" }, context(cwd));
      expect(unrelated.ok).toBe(true);
      expect(unrelated.output).toContain("still works");

      expect(runtime.elicitation.pending()).toHaveLength(1);
      const answered = runtime.elicitation.answer(request?.id ?? "", {
        action: "accept",
        content: { name: "Sasha" },
      });
      expect(answered).toBe(true);

      const result = await pending;
      expect(result.ok).toBe(true);
      expect(result.output).toContain("Sasha");
      expect(result.output).toContain('"action":"accept"');
    } finally {
      await runtime.close();
    }
  });
});
