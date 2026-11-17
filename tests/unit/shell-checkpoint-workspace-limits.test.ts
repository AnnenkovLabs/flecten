import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CheckpointStore,
  ShellCheckpointService,
  WorkspaceSnapshots,
} from "../../src/store/checkpoints";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("automatic shell snapshots reject over-budget workspaces before hashing their data", async () => {
  for (const limits of [{ maxPaths: 2 }, { maxCaptureBytes: 16 }, { setupMs: 0 }]) {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-workspace-budget-"));
    directories.push(cwd);
    await mkdir(join(cwd, "data"));
    for (let index = 0; index < 3; index += 1) {
      await writeFile(join(cwd, "data", `${index}.txt`), "12345678");
    }
    const snapshots = new WorkspaceSnapshots(cwd, join(cwd, ".flecten", "shadow"), limits);
    const shell = new ShellCheckpointService(snapshots, new CheckpointStore({ cwd }));
    const reason = await shell.ready();
    expect(reason).toBeDefined();
    const summary = await (
      await shell.begin({ tool: "bash", label: "noop", command: "true", sessionId: "s_1" })
    ).finish();
    expect(summary.unavailable).toBe(reason);
    expect(summary.id).toBeUndefined();
    const objects = await readdir(join(cwd, ".flecten", "shadow", "objects")).catch(() => []);
    expect(objects.filter((name) => name !== "info" && name !== "pack")).toEqual([]);
  }
});
