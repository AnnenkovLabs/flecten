import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CheckpointStore,
  ShellCheckpointService,
  WorkspaceSnapshots,
} from "../../src/store/checkpoints";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(child.stdout).text();
  await child.exited;
  return out;
}

/** A user repository with one commit, a staged file and an ignored build folder. */
async function userRepo(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-shell-cp-"));
  dirs.push(cwd);
  await git(cwd, "init", "-q");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "user.name", "Test");
  await writeFile(join(cwd, ".gitignore"), "build/\n.liquid/\n");
  await writeFile(join(cwd, "a.txt"), "alpha\n");
  await writeFile(join(cwd, "b.txt"), "beta\n");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-q", "-m", "init");
  await writeFile(join(cwd, "staged.txt"), "staged\n");
  await git(cwd, "add", "staged.txt");
  await mkdir(join(cwd, "build"), { recursive: true });
  await writeFile(join(cwd, "build", "out.js"), "compiled\n");
  return cwd;
}

async function service(cwd: string, limits: { maxFiles?: number } = {}) {
  const store = new CheckpointStore({ cwd });
  await store.init();
  const snapshots = new WorkspaceSnapshots(cwd, join(cwd, ".liquid", "shadow"));
  const shell = new ShellCheckpointService(snapshots, store, limits);
  expect(await shell.ready()).toBeUndefined();
  return { store, shell };
}

async function userGitState(cwd: string) {
  return {
    status: await git(cwd, "status", "--porcelain=v1", "--untracked-files=all"),
    head: await git(cwd, "rev-parse", "HEAD"),
    refs: await git(cwd, "for-each-ref"),
    stash: await git(cwd, "stash", "list"),
    staged: await git(cwd, "diff", "--cached", "--name-only"),
  };
}

const request = { tool: "bash", label: "test", command: "edit files", sessionId: "s_1" };

describe("shell checkpoints", () => {
  test("the command deadline includes a contended persistence mutex and publishes no late manifest", async () => {
    const cwd = await userRepo();
    let resume: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      resume = resolve;
    });
    class ContendedStore extends CheckpointStore {
      override async init(): Promise<void> {
        await held;
        await super.init();
      }
    }
    const store = new ContendedStore({ cwd });
    const snapshots = new WorkspaceSnapshots(cwd, join(cwd, ".liquid", "shadow"));
    const shell = new ShellCheckpointService(snapshots, store);
    expect(await shell.ready()).toBeUndefined();
    const blocker = store.capture({ paths: ["a.txt"], tool: "write", label: "concurrent session" });
    try {
      const handle = await shell.begin(request);
      await writeFile(join(cwd, "a.txt"), "changed\n");
      const started = performance.now();
      const result = await handle.finish();
      expect(performance.now() - started).toBeLessThan(4000);
      expect(result.id).toBeUndefined();
      expect(result.gap?.reason).toContain("время");
      resume();
      await blocker;
      const next = await store.capture({
        paths: ["b.txt"],
        tool: "write",
        label: "after deadline",
      });
      expect(next.id).toBeDefined();
      expect((await store.list()).map((entry) => entry.label).sort()).toEqual([
        "after deadline",
        "concurrent session",
      ]);
    } finally {
      resume();
      await blocker;
    }
  });

  test("undo restores edits, deletes and creations without touching the user's git", async () => {
    const cwd = await userRepo();
    const { store, shell } = await service(cwd);
    const before = await userGitState(cwd);

    const handle = await shell.begin(request);
    await writeFile(join(cwd, "a.txt"), "changed\n");
    await rm(join(cwd, "b.txt"));
    await writeFile(join(cwd, "new.txt"), "created\n");
    const summary = await handle.finish();

    expect(summary.id).toBeDefined();
    expect(summary.files).toBe(3);
    expect(summary.gap).toBeUndefined();
    expect(summary.tookMs).toBeLessThan(5000);

    await store.restore(summary.id ?? "", "before");
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("alpha\n");
    expect(await readFile(join(cwd, "b.txt"), "utf8")).toBe("beta\n");
    expect(await Bun.file(join(cwd, "new.txt")).exists()).toBe(false);
    expect(await userGitState(cwd)).toEqual(before);
  });

  test("a command that changes nothing leaves no checkpoint", async () => {
    const cwd = await userRepo();
    const { shell } = await service(cwd);
    const summary = await (await shell.begin(request)).finish();
    expect(summary.id).toBeUndefined();
    expect(summary.files).toBe(0);
  });

  test("ignored files named by the command are captured, so rm -rf build can be undone", async () => {
    const cwd = await userRepo();
    const { store, shell } = await service(cwd);
    expect(await shell.ignored(["build"])).toMatchObject({ files: 1, over: false });

    const handle = await shell.begin({ ...request, include: ["build"] });
    await rm(join(cwd, "build"), { recursive: true, force: true });
    const summary = await handle.finish();
    expect(summary.files).toBe(1);

    await store.restore(summary.id ?? "", "before");
    expect(await readFile(join(cwd, "build", "out.js"), "utf8")).toBe("compiled\n");
  });

  test("past the file limit the checkpoint keeps what fits and reports the gap", async () => {
    const cwd = await userRepo();
    const { shell } = await service(cwd, { maxFiles: 3 });
    const handle = await shell.begin(request);
    for (let index = 0; index < 8; index += 1) {
      await writeFile(join(cwd, `gen-${index}.txt`), `file ${index}\n`);
    }
    const summary = await handle.finish();
    expect(summary.files).toBe(3);
    expect(summary.gap?.files).toBe(5);
    expect(summary.gap?.reason).toContain("лимит");
  });

  test("on a big tree a command checkpoint follows the change, not the tree size", async () => {
    const cwd = await userRepo();
    const writes: Promise<unknown>[] = [];
    for (let dir = 0; dir < 40; dir += 1) {
      await mkdir(join(cwd, "src", `m${dir}`), { recursive: true });
      for (let file = 0; file < 250; file += 1) {
        writes.push(
          writeFile(join(cwd, "src", `m${dir}`, `f${file}.ts`), `export const v = ${file};\n`),
        );
      }
    }
    await Promise.all(writes);
    const { shell } = await service(cwd);

    const started = performance.now();
    const handle = await shell.begin(request);
    await writeFile(join(cwd, "src", "m7", "f7.ts"), "export const v = -1;\n");
    const summary = await handle.finish();
    const elapsed = performance.now() - started;

    expect(summary.files).toBe(1);
    expect(elapsed).toBeLessThan(5000);
  }, 60_000);

  test("a capture that cannot finish before its deadline gives up instead of blocking", async () => {
    const cwd = await userRepo();
    const snapshots = new WorkspaceSnapshots(cwd, join(cwd, ".liquid", "shadow"));
    const started = Date.now();
    const result = await snapshots.capture({ deadline: Date.now() });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.ok).toBe(false);
  });
});
