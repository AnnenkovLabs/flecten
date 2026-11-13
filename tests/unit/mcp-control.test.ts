import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "../../src/config/schema";
import { parseMcpServerConfig } from "../../src/mcp/config";
import { connectMcpServers } from "../../src/mcp/session";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-mcp-control-"));
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
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("MCP server access control", () => {
  test("applies allowTools and blocks mutating tools in read-only mode", async () => {
    const cwd = await tempDir();
    const runtime = await connectMcpServers(
      {
        local: {
          ...serverConfig(),
          allowTools: ["echo", "write"],
          readOnly: true,
        },
      },
      cwd,
    );
    try {
      expect(runtime.tools.map((tool) => tool.name)).toEqual(["mcp_local_echo", "mcp_local_write"]);
      expect(runtime.statuses[0]).toMatchObject({ state: "ready", tools: 2, readOnly: true });
      expect(runtime.statuses[0]?.diagnostics).toContain("allowTools excluded 2 server tools");

      const echo = runtime.tools.find((tool) => tool.name === "mcp_local_echo");
      expect(echo?.mutating).toBe(true);
      const result = await echo?.execute({ text: "hello" }, context(cwd));
      expect(result).toMatchObject({ ok: false });
      expect(result?.error).toContain("read-only");
      expect(result?.error).toContain("blocked before execution");
    } finally {
      await runtime.close();
    }
  });

  test("validates tool arguments before calling the server", async () => {
    const cwd = await tempDir();
    const runtime = await connectMcpServers({ local: serverConfig() }, cwd);
    try {
      const echo = runtime.tools.find((tool) => tool.name === "mcp_local_echo");
      const result = await echo?.execute({}, context(cwd));
      expect(result?.ok).toBe(false);
      expect(result?.error).toContain("text");
    } finally {
      await runtime.close();
    }
  });

  test("exposes bounded redacted logs", async () => {
    const cwd = await tempDir();
    const runtime = await connectMcpServers({ local: serverConfig({ MCP_TEST_STDERR: "1" }) }, cwd);
    try {
      const logs = runtime.logs("local", 100);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.length).toBeLessThanOrEqual(50);
      for (const entry of logs) {
        expect(entry.server).toBe("local");
        expect(entry.message.length).toBeLessThanOrEqual(1000);
      }
      expect(runtime.statuses[0]?.logs?.length).toBeLessThanOrEqual(10);
      expect(runtime.health("local")).toMatchObject([{ server: "local", state: "ready" }]);
    } finally {
      await runtime.close();
    }
  });

  test("reconnects a failed stdio server", async () => {
    const cwd = await tempDir();
    const runtime = await connectMcpServers(
      {
        local: serverConfig({ MCP_TEST_FAIL_ONCE_FILE: join(cwd, "failed-once") }),
      },
      cwd,
    );
    try {
      expect(runtime.statuses[0]?.state).toBe("failed");
      expect(runtime.tools).toHaveLength(0);
      expect(runtime.health("local")).toMatchObject([{ server: "local", state: "failed" }]);

      const statuses = await runtime.reconnect("local");
      expect(statuses[0]).toMatchObject({ id: "local", state: "ready", tools: 3 });
      expect(runtime.statuses[0]).toMatchObject({ id: "local", state: "ready", tools: 3 });
      expect(runtime.tools.map((tool) => tool.name)).toContain("mcp_local_echo");
    } finally {
      await runtime.close();
    }
  });

  test("refreshes tools after tools/list_changed", async () => {
    const cwd = await tempDir();
    const runtime = await connectMcpServers(
      { local: serverConfig({ MCP_TEST_DYNAMIC: "1" }) },
      cwd,
    );
    try {
      expect(runtime.tools.map((tool) => tool.name)).toContain("mcp_local_notify");
      expect(runtime.tools.map((tool) => tool.name)).not.toContain("mcp_local_dynamic");

      const notify = runtime.tools.find((tool) => tool.name === "mcp_local_notify");
      const result = await notify?.execute({}, context(cwd));
      expect(result?.ok).toBe(true);

      await waitFor(() => runtime.tools.some((tool) => tool.name === "mcp_local_dynamic"));
      expect(runtime.statuses[0]?.tools).toBe(5);
      expect(runtime.statuses[0]?.state).toBe("ready");
      expect(runtime.tools.map((tool) => tool.name)).toEqual([
        "mcp_local_dynamic",
        "mcp_local_echo",
        "mcp_local_fail",
        "mcp_local_notify",
        "mcp_local_write",
      ]);
    } finally {
      await runtime.close();
    }
  });
});

describe("MCP health and reconnect over Streamable HTTP", () => {
  test("reports health counters and reconnects on demand", async () => {
    let attempts = 0;
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const message = (await request.json()) as { id?: number; method: string };
        if (message.method === "initialize") {
          attempts += 1;
          if (attempts === 1) return new Response("warming up", { status: 503 });
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                protocolVersion: "2026-07-28",
                capabilities: { tools: {} },
                serverInfo: { name: "health", version: "1.0.0" },
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (message.method === "notifications/initialized") {
          return new Response(null, { status: 202 });
        }
        if (message.method === "tools/list") {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [] } }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);

    const cwd = await tempDir();
    const runtime = await connectMcpServers(
      { remote: parseMcpServerConfig({ url: server.url.toString() }) },
      cwd,
      { health: { maxAttempts: 1 } },
    );
    try {
      expect(runtime.health("remote")).toMatchObject([
        { server: "remote", state: "degraded", counters: { attempts: 1, failures: 1 } },
      ]);
      expect(runtime.statuses[0]?.nextRetryAt).toBeUndefined();

      const statuses = await runtime.reconnect("remote");
      expect(statuses[0]).toMatchObject({ id: "remote", state: "ready", tools: 0 });
      expect(runtime.health("remote")).toMatchObject([
        {
          server: "remote",
          state: "ready",
          counters: { attempts: 2, successes: 1, failures: 1, reconnects: 1 },
        },
      ]);
    } finally {
      await runtime.close();
    }
  });
});
