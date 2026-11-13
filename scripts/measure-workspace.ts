import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CheckpointStore,
  ShellCheckpointService,
  WorkspaceSnapshots,
} from "../src/store/checkpoints";
import { runGrep } from "../src/tools/grep/run";

// Explicit acceptance fixture, outside the default unit suite: creation is not command overhead.
const files = Number(process.argv[2] ?? 100_000);
assert(Number.isInteger(files) && files >= 1000 && files <= 300_000, "Use 1000..300000 files");
const cwd = await mkdtemp(join(tmpdir(), "liquid-workspace-perf-"));
const metrics: Record<string, number> = { files, budgetMs: 5000 };
async function measure<T>(name: string, action: () => Promise<T>, bounded = true): Promise<T> {
  const start = performance.now();
  const result = await action();
  metrics[name] = Math.round(performance.now() - start);
  if (bounded) assert(metrics[name] < 5000, `${name} exceeded 5s: ${metrics[name]}ms`);
  return result;
}
try {
  await measure(
    "fixtureMs",
    async () => {
      for (let base = 0; base < files; base += 1000) {
        const dir = join(cwd, `group-${base}`);
        await mkdir(dir);
        for (let offset = 0; offset < Math.min(1000, files - base); offset += 100) {
          await Promise.all(
            Array.from({ length: Math.min(100, files - base - offset, 1000 - offset) }, (_, i) =>
              writeFile(join(dir, `file-${offset + i}.ts`), "export const value = 1;\n"),
            ),
          );
        }
      }
      await writeFile(join(cwd, "target.ts"), "WORKSPACE_MEASURE_UNIQUE\n");
      await writeFile(join(cwd, ".gitignore"), ".liquid/\n");
    },
    false,
  );
  const store = new CheckpointStore({ cwd });
  await store.init();
  const snapshots = new WorkspaceSnapshots(cwd, join(cwd, ".liquid", "shadow"));
  const shell = new ShellCheckpointService(snapshots, store);
  assert.equal(await measure("warmMs", () => shell.ready(), false), undefined);
  const search = await measure("searchMs", () =>
    runGrep(
      { pattern: "WORKSPACE_MEASURE_UNIQUE", literal: true },
      {
        cwd,
        signal: AbortSignal.timeout(5000),
      },
    ),
  );
  assert(search.ok && search.output.includes("target.ts"), "Search must find the actual fixture");
  const handle = await measure("snapshotBeforeMs", () =>
    shell.begin({
      tool: "bash",
      label: "large workspace",
      command: "change target",
      sessionId: "s_perf",
    }),
  );
  await writeFile(join(cwd, "target.ts"), "changed target\n");
  const checkpoint = await measure("snapshotAfterMs", () => handle.finish());
  assert(
    checkpoint.id && !checkpoint.gap && !checkpoint.unavailable,
    "Checkpoint must contain the edit",
  );
  const id = checkpoint.id;
  assert(id);
  metrics.checkpointOverheadMs = (metrics.snapshotBeforeMs ?? 0) + (metrics.snapshotAfterMs ?? 0);
  assert(metrics.checkpointOverheadMs < 5000, "Combined command overhead exceeds 5s");
  const diff = await measure("diffMs", () => store.diff(id));
  assert.equal(diff.files.length, 1);
  assert.equal(diff.files[0]?.path, "target.ts");
  await measure("undoMs", () => store.restore(id, "before"));
  assert.equal(await readFile(join(cwd, "target.ts"), "utf8"), "WORKSPACE_MEASURE_UNIQUE\n");
  await measure("redoMs", () => store.restore(id, "after"));
  assert.equal(await readFile(join(cwd, "target.ts"), "utf8"), "changed target\n");
  console.log(JSON.stringify({ ok: true, ...metrics }, null, 2));
} finally {
  await rm(cwd, { recursive: true, force: true });
}
