import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "../../src/config/schema";
import { renderMcpInstructions } from "../../src/mcp/prompt";
import { connectMcpServers } from "../../src/mcp/session";
import { ToolRegistry } from "../../src/tools/registry";
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
  const dir = await mkdtemp(join(tmpdir(), "liquid-mcp-"));
  dirs.push(dir);
  return dir;
}

function serverConfig(): McpServerConfig {
  return {
    command: process.execPath,
    args: [join(import.meta.dir, "..", "fixtures", "mcp-stdio-server.ts")],
    env: {},
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

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("MCP stdio", () => {
  test("connects, lists tools and calls them through the registry", async () => {
    const cwd = await tempDir();
    const runtime = await connectMcpServers(
      { local: { ...serverConfig(), protocol: "auto" } },
      cwd,
    );
    try {
      expect(runtime.statuses).toMatchObject([
        {
          id: "local",
          state: "ready",
          tools: 3,
          available: 4,
          protocol: "2025-06-18",
        },
      ]);
      expect(runtime.statuses[0]?.diagnostics?.[0]).toContain("oversized inputSchema");
      expect(runtime.instructions[0]?.text).toContain("Use echo");
      expect(runtime.tools.map((tool) => tool.name)).toEqual([
        "mcp_local_echo",
        "mcp_local_fail",
        "mcp_local_write",
      ]);
      const echo = runtime.tools.find((tool) => tool.name === "mcp_local_echo");
      const write = runtime.tools.find((tool) => tool.name === "mcp_local_write");
      expect(echo?.mutating).toBe(true);
      expect(write?.mutating).toBe(true);
      expect(echo?.parameters).toMatchObject({ type: "object" });

      const registry = new ToolRegistry(runtime.tools, { limits });
      const result = await registry.run(
        { id: "call-1", name: "mcp_local_echo", args: { text: "hello" } },
        context(cwd),
      );
      expect(result.ok).toBe(true);
      expect(result.output).toContain("echo: hello");
      expect(result.output).toContain('"text": "hello"');

      const failed = await registry.run(
        { id: "call-2", name: "mcp_local_fail", args: {} },
        context(cwd),
      );
      expect(failed.ok).toBe(false);
      expect(failed.error).toContain("expected failure");
    } finally {
      await runtime.close();
    }
  });

  test("keeps completed mutations when the server violates its output schema", async () => {
    const cwd = await tempDir();
    const actionLog = join(cwd, "actions.log");
    const runtime = await connectMcpServers(
      {
        local: {
          ...serverConfig(),
          args: [join(import.meta.dir, "..", "fixtures", "mcp-output-schema-server.ts")],
          env: { MCP_TEST_ACTION_LOG: actionLog },
        },
      },
      cwd,
    );
    try {
      expect(runtime.statuses[0]?.state).toBe("ready");
      const registry = new ToolRegistry(runtime.tools, { limits });
      const invoke = (id: string, args: unknown) =>
        registry.run({ id, name: "mcp_local_mutate", args }, context(cwd));
      const invalid = await invoke("invalid-input", { response: 7 });
      expect(invalid.ok).toBe(false);
      expect(await Bun.file(actionLog).exists()).toBe(false);

      const completed = await invoke("completed-action", { response: "mismatched" });
      expect(completed.ok).toBe(true);
      expect(completed.output).toContain("mutation completed");
      expect(completed.output).toContain('"accepted": "yes"');
      expect(await readFile(actionLog, "utf8")).toBe("mutation\n");

      const failed = await invoke("server-error", { response: "failed" });
      expect(failed.ok).toBe(false);
      expect(failed.error).toContain("mutation refused");
      const malformed = await invoke("invalid-envelope", { response: "malformed" });
      expect(malformed.ok).toBe(false);
      expect(await readFile(actionLog, "utf8")).toBe("mutation\n");
    } finally {
      await runtime.close();
    }
  });

  test("reports a server that cannot start without breaking other tools", async () => {
    const cwd = await tempDir();
    const runtime = await connectMcpServers(
      {
        good: serverConfig(),
        bad: { ...serverConfig(), command: join(cwd, "missing-server") },
      },
      cwd,
    );
    try {
      expect(runtime.statuses.find((entry) => entry.id === "good")?.state).toBe("ready");
      const bad = runtime.statuses.find((entry) => entry.id === "bad");
      expect(bad?.state).toBe("failed");
      expect(bad?.error?.length).toBeGreaterThan(0);
      expect(runtime.tools.length).toBe(3);
    } finally {
      await runtime.close();
    }
  });

  test("bounds combined server instructions in the prompt", () => {
    const instructions = Array.from({ length: 10 }, (_, index) => ({
      server: `server-${index}`,
      text: "x".repeat(4000),
    }));
    const text = renderMcpInstructions(instructions);
    expect(text?.length).toBeLessThan(17_000);
    expect(text).toContain("server guidance blocks omitted");
  });

  test("respects per-server tool limits", async () => {
    const cwd = await tempDir();
    const runtime = await connectMcpServers({ local: { ...serverConfig(), maxTools: 1 } }, cwd);
    try {
      expect(runtime.tools).toHaveLength(1);
      expect(runtime.statuses[0]?.tools).toBe(1);
    } finally {
      await runtime.close();
    }
  });
});
