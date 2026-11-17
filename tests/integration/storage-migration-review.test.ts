import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  acceptStorageMigration,
  inspectStorageMigration,
  interruptedStorageMigration,
  migrateStorageRoots,
} from "../../src/store/storage-migration";
import { paths } from "../../src/store/storage-migration/state";

const directories: string[] = [];
const progress = () => {};
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await chmod(directory, 0o700);
    await rm(directory, { recursive: true, force: true });
  }
});
async function root() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "flecten-migration-review-")));
  directories.push(path);
  return path;
}
async function file(root: string, path: string, text: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}
async function child(script: string) {
  const instance = Bun.spawn([process.execPath, "--eval", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    instance.exited,
    new Response(instance.stdout).text(),
    new Response(instance.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("accepted roots stay usable after runtime writes, with a live core and without write access", async () => {
  const directory = await root();
  const p = paths(directory);
  await file(p.current, "memory.json", "before migration");
  await migrateStorageRoots([directory], progress);
  await acceptStorageMigration([directory]);
  await file(p.current, "memory.json", "runtime update");
  await file(p.current, "sidecar.lock", JSON.stringify({ pid: process.pid }));
  await file(p.transaction, "state.json", "obsolete broken transaction");
  await chmod(p.transaction, 0o500);
  try {
    expect(await inspectStorageMigration([directory])).toEqual({ required: false });
    expect(await interruptedStorageMigration([directory])).toBe(false);
    await migrateStorageRoots([directory], progress);
    await acceptStorageMigration([directory]);
    expect(await readFile(join(p.current, "memory.json"), "utf8")).toBe("runtime update");
  } finally {
    await chmod(p.transaction, 0o700);
  }
});

test("correcting a pre-publication conflict replans without changing previous immutable backups", async () => {
  const directory = await root();
  const p = paths(directory);
  await file(p.current, "memory.json", "current original");
  await file(p.legacy, "memory.json", "legacy original");
  await expect(migrateStorageRoots([directory], progress)).rejects.toThrow(
    "Keep saved copies unchanged",
  );
  await file(p.legacy, "memory.json", "current original");
  await migrateStorageRoots([directory], progress);
  expect(await readFile(join(p.originals, "current/memory.json"), "utf8")).toBe("current original");
  expect(await readFile(join(p.originals, "legacy/memory.json"), "utf8")).toBe("legacy original");
  expect(await readFile(join(paths(directory, 1).originals, "legacy/memory.json"), "utf8")).toBe(
    "current original",
  );
  await acceptStorageMigration([directory]);
  expect(await inspectStorageMigration([directory])).toEqual({ required: false });
});

test("SIGKILL after one root acceptance resumes remaining roots and keeps accepted runtime changes", async () => {
  const first = await root();
  const second = await root();
  await file(paths(first).current, "memory.json", "first");
  await file(paths(second).legacy, "memory.json", "second");
  await migrateStorageRoots([first, second], progress);
  const result = await child(`
    import { mock } from "bun:test";
    const actual = { ...await import("node:fs/promises") };
    mock.module("node:fs/promises", () => ({ ...actual, rename: async (source, target) => {
      await actual.rename(source, target);
      if (target === ${JSON.stringify(paths(first).accepted)}) process.kill(process.pid, "SIGKILL");
    } }));
    const { acceptStorageMigration } = await import(${JSON.stringify(resolve("src/store/storage-migration/index.ts"))});
    await acceptStorageMigration(${JSON.stringify([first, second])});
    process.exit(99);
  `);
  expect(result.code).not.toBe(0);
  expect(result.code).not.toBe(99);
  expect(result.stderr).toBe("");
  expect(await Bun.file(paths(first).accepted).exists()).toBe(true);
  expect(await Bun.file(paths(second).accepted).exists()).toBe(false);
  await file(paths(first).current, "memory.json", "first runtime update");
  expect(await interruptedStorageMigration([first, second])).toBe(true);
  await migrateStorageRoots([first, second], progress);
  await acceptStorageMigration([first, second]);
  expect(await inspectStorageMigration([first, second])).toEqual({ required: false });
  expect(await readFile(join(paths(first).current, "memory.json"), "utf8")).toBe(
    "first runtime update",
  );
});

test("two stale-lock contenders cannot overlap their storage writes", async () => {
  const directory = await root();
  const p = paths(directory);
  const stale = Bun.spawn([process.execPath, "--eval", ""], { stdout: "ignore", stderr: "ignore" });
  await stale.exited;
  await file(p.transaction, "engine.lock", JSON.stringify({ pid: stale.pid, token: "dead" }));
  const script = (name: string) => `
    import { mock } from "bun:test";
    const actual = { ...await import("node:fs/promises") };
    mock.module("node:fs/promises", () => ({ ...actual, rm: async (path, options) => {
      if (path === ${JSON.stringify(p.lock)} && ${JSON.stringify(name)} === "slow") await Bun.sleep(40);
      return actual.rm(path, options);
    } }));
    const { withRootLock } = await import(${JSON.stringify(resolve("src/store/storage-migration/state.ts"))});
    try {
      await withRootLock(${JSON.stringify(directory)}, async () => {
        await actual.writeFile(${JSON.stringify(join(directory, "writer"))}, ${JSON.stringify(name)}, { flag: "wx" });
        await Bun.sleep(100);
        await actual.rm(${JSON.stringify(join(directory, "writer"))});
      });
      process.stdout.write("done");
    } catch (error) {
      if (!error.message.includes("already running")) throw error;
      process.stdout.write("busy");
    }
  `;
  const results = await Promise.all([child(script("fast")), child(script("slow"))]);
  expect(results.every(({ code, stderr }) => code === 0 && stderr === "")).toBe(true);
  expect(results.some(({ stdout }) => stdout === "done")).toBe(true);
});

test.each(["retiring", "retired"])(
  "a missing %s rename destination recovers from verified original copies",
  async (phase) => {
    const directory = await root();
    const p = paths(directory);
    await file(p.current, "memory.json", "original");
    const result = await child(`
    import { readFileSync } from "node:fs";
    const { migrateStorageRoots } = await import(${JSON.stringify(resolve("src/store/storage-migration/index.ts"))});
    await migrateStorageRoots([${JSON.stringify(directory)}], () => {
      if (JSON.parse(readFileSync(${JSON.stringify(p.state)}, "utf8")).phase === ${JSON.stringify(phase)}) process.kill(process.pid, "SIGKILL");
    });
    process.exit(99);
  `);
    expect(result.code).not.toBe(0);
    expect(result.code).not.toBe(99);
    expect(result.stderr).toBe("");
    // Model lost directory entries after sudden power loss, while synced backup entries survive.
    await rm(phase === "retiring" ? p.current : p.staging, { recursive: true });
    await migrateStorageRoots([directory], progress);
    await acceptStorageMigration([directory]);
    expect(await readFile(join(p.current, "memory.json"), "utf8")).toBe("original");
    expect(await readFile(join(p.originals, "current/memory.json"), "utf8")).toBe("original");
  },
);
