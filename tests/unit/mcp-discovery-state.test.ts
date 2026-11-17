import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ToolRegistry } from "../../src/tools/registry";
import { defineTool } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

test("activation cannot exceed the durable checkpoint schema across several catalog calls", async () => {
  const limits = {
    maxOutputBytes: 50_000,
    maxOutputLines: 2000,
    bashTimeoutMs: 1000,
    readLimitLines: 100,
  };
  const tools = Array.from({ length: 129 }, (_, index) =>
    defineTool({
      name: `mcp_test_${index}`,
      description: "External fixture",
      source: "mcp",
      schema: z.object({}),
      async execute() {
        return { ok: true, output: "" };
      },
    }),
  );
  const registry = new ToolRegistry(tools, { limits, deferredMcp: true });
  const cwd = await mkdtemp(join(tmpdir(), "flecten-discovery-limit-"));
  const context = {
    cwd,
    sessionId: "s_test",
    signal: AbortSignal.timeout(1000),
    logDir: cwd,
    limits,
    reads: new ReadTracker(),
  };
  try {
    expect(
      await registry.run(
        {
          id: "selection",
          name: "tool_catalog",
          args: { operation: "activate", names: tools.slice(0, 128).map((tool) => tool.name) },
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await registry.run(
        {
          id: "overflow",
          name: "tool_catalog",
          args: { operation: "activate", names: [tools[128]?.name] },
        },
        context,
      ),
    ).toMatchObject({ ok: false, error: "A session can activate at most 128 external tools." });
    expect(registry.activeMcpTools()).toHaveLength(128);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
