import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerTool } from "../../src/app/worker-tool";
import { executeCalls } from "../../src/core/loop/tools";
import type { ToolResult } from "../../src/core/types";
import { PermissionEngine } from "../../src/security/permissions";
import { ToolRegistry } from "../../src/tools/registry";
import { ReadTracker } from "../../src/tools/util/read-tracker";

test("Worker status is bounded inspection while start remains a separately guarded mutation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "worker-status-"));
  try {
    let executed = 0;
    const tool = workerTool(async () => ({ turns: ++executed }));
    const limits = {
      maxOutputBytes: 1000,
      maxOutputLines: 100,
      bashTimeoutMs: 100,
      readLimitLines: 100,
    };
    const signal = new AbortController().signal;
    const permissions = new PermissionEngine({
      rules: [
        { action: "read", policy: "auto" },
        { action: "write", policy: "deny" },
      ],
    });
    const options = {
      tools: new ToolRegistry([tool], { limits }),
      toolContext: {
        cwd,
        sessionId: "test",
        logDir: join(cwd, "logs"),
        signal,
        permissions,
        limits,
        reads: new ReadTracker(),
      },
      signal,
      parallelTools: false,
    };
    const results: ToolResult[] = [];
    await executeCalls(
      [{ id: "status", name: "worker", args: { operation: "status" } }],
      options,
      () => {},
      results,
    );
    expect(results[0]).toMatchObject({ ok: true, data: { turns: 1 } });
    await executeCalls(
      [{ id: "start", name: "worker", args: { operation: "start", task: "run tests" } }],
      options,
      () => {},
      results,
    );
    expect(results[1]).toMatchObject({ ok: false, data: { kind: "permission" } });
    expect(executed).toBe(1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
