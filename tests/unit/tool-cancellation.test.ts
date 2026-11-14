import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointStore } from "../../src/store/checkpoints";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

for (const [name, args] of [
  ["write", { path: "a.txt", content: "after\n" }],
  ["edit", { path: "a.txt", oldString: "before", newString: "after" }],
  ["delete", { path: "a.txt" }],
  ["move", { from: "a.txt", to: "b.txt", overwrite: true }],
  [
    "apply_patch",
    { patch: "*** Begin Patch\n*** Update File: a.txt\n@@\n-before\n+after\n*** End Patch" },
  ],
] as const) {
  test(`${name} cannot mutate files after cancellation during checkpoint capture`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-cancel-mutation-"));
    dirs.push(cwd);
    await writeFile(join(cwd, "a.txt"), "before\n");
    await writeFile(join(cwd, "b.txt"), "target\n");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    class DelayedCheckpointStore extends CheckpointStore {
      override async capture(options: Parameters<CheckpointStore["capture"]>[0]) {
        entered.resolve();
        await release.promise;
        return super.capture(options);
      }
    }
    const controller = new AbortController();
    const reads = new ReadTracker();
    reads.record(join(cwd, "a.txt"), "before\n");
    const context: ToolContext = {
      cwd,
      sessionId: "cancel-session",
      signal: controller.signal,
      logDir: join(cwd, ".liquid", "logs"),
      reads,
      limits: {
        maxOutputBytes: 50_000,
        maxOutputLines: 2000,
        bashTimeoutMs: 1000,
        readLimitLines: 2000,
      },
      checkpoints: new DelayedCheckpointStore({ cwd }),
    };
    const registry = new ToolRegistry(
      builtinTools().map((tool) =>
        tool.name !== name
          ? tool
          : {
              ...tool,
              execute: async (input, current) => {
                try {
                  return await tool.execute(input, current);
                } finally {
                  finished.resolve();
                }
              },
            },
      ),
      { limits: context.limits },
    );
    const execution = registry.run({ id: `cancel-${name}`, name, args }, context);
    await entered.promise;
    controller.abort();
    const result = await execution;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Tool aborted");
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("before\n");
    release.resolve();
    await finished.promise;
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("before\n");
    expect(await readFile(join(cwd, "b.txt"), "utf8")).toBe("target\n");
  });
}
