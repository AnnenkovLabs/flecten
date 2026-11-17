import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acceptStorageMigration, migrateStorageRoots } from "../../src/store/storage-migration";
import { paths } from "../../src/store/storage-migration/state";

const directories: string[] = [];
const engine = resolve("src/store/storage-migration/index.ts");
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "flecten-migration-performance-")));
  directories.push(root);
  const payload = join(root, ".flecten", "payload");
  await mkdir(payload, { recursive: true });
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      writeFile(
        join(payload, `file-${String(index).padStart(2, "0")}.bin`),
        Buffer.alloc(1024, index),
      ),
    ),
  );
  return root;
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
  expect(stderr).toBe("");
  expect(code).toBe(0);
  return JSON.parse(stdout);
}

test("startup migration overlaps bounded file reads and copies", async () => {
  const root = await fixture();
  const result = await child(`
    import { mock } from "bun:test";
    import { sep } from "node:path";
    const actual = { ...await import("node:fs/promises") };
    let reads = 0, maxReads = 0, copies = 0, maxCopies = 0, hashPasses = 0;
    mock.module("node:fs/promises", () => ({ ...actual, open: async (path, flags, ...rest) => {
      const handle = await actual.open(path, flags, ...rest);
      if (!String(path).split(sep).join("/").includes("/payload/")) return handle;
      const read = handle.read.bind(handle);
      handle.read = async (...args) => {
        if (args[3] === 0) hashPasses++;
        maxReads = Math.max(maxReads, ++reads);
        try { await Bun.sleep(3); return await read(...args); }
        finally { reads--; }
      };
      if (typeof flags === "string" && flags.startsWith("wx")) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          maxCopies = Math.max(maxCopies, ++copies);
          try { await Bun.sleep(3); return await sync(); }
          finally { copies--; }
        };
      }
      return handle;
    } }));
    const { migrateStorageRoots, acceptStorageMigration } = await import(${JSON.stringify(engine)});
    await migrateStorageRoots([${JSON.stringify(root)}], () => {});
    await acceptStorageMigration([${JSON.stringify(root)}]);
    process.stdout.write(JSON.stringify({ maxReads, maxCopies, reads, copies, hashPasses }));
  `);
  expect(result.maxReads).toBeGreaterThan(1);
  expect(result.maxReads).toBeLessThanOrEqual(16);
  expect(result.maxCopies).toBeGreaterThan(1);
  expect(result.maxCopies).toBeLessThanOrEqual(16);
  expect(result.reads).toBe(0);
  expect(result.copies).toBe(0);
  expect(result.hashPasses).toBeLessThanOrEqual(24 * 5);
});

test("a failed parallel backup drains all writers before releasing its root lock", async () => {
  const root = await fixture();
  const result = await child(`
    import { mock } from "bun:test";
    import { sep } from "node:path";
    const actual = { ...await import("node:fs/promises") };
    let injected = false, openWriters = 0, maxWriters = 0, syncing = 0;
    mock.module("node:fs/promises", () => ({ ...actual, open: async (path, flags, ...rest) => {
      const handle = await actual.open(path, flags, ...rest);
      if (!String(path).split(sep).join("/").includes("/originals/current/payload/") ||
          typeof flags !== "string" || !flags.startsWith("wx")) return handle;
      maxWriters = Math.max(maxWriters, ++openWriters);
      const sync = handle.sync.bind(handle), close = handle.close.bind(handle);
      handle.sync = async () => {
        syncing++;
        try {
          if (!injected && String(path).endsWith("file-00.bin")) {
            injected = true;
            await Bun.sleep(10);
            throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
          }
          await Bun.sleep(80);
          return await sync();
        } finally { syncing--; }
      };
      handle.close = async () => {
        try { return await close(); }
        finally { openWriters--; }
      };
      return handle;
    } }));
    const { migrateStorageRoots, acceptStorageMigration } = await import(${JSON.stringify(engine)});
    let failure;
    try { await migrateStorageRoots([${JSON.stringify(root)}], () => {}); }
    catch (error) { failure = error.code; }
    const drained = { failure, openWriters, syncing, maxWriters };
    await migrateStorageRoots([${JSON.stringify(root)}], () => {});
    await acceptStorageMigration([${JSON.stringify(root)}]);
    process.stdout.write(JSON.stringify(drained));
  `);
  expect(result.failure).toBe("ENOSPC");
  expect(result.maxWriters).toBeGreaterThan(1);
  expect(result.openWriters).toBe(0);
  expect(result.syncing).toBe(0);
});

test.each([
  ["backed-up", "backup", "Backup hash verification failed"],
  ["merged", "staging", "Staging hash verification failed"],
])("restart at %s verifies the %s again", async (phase, damaged, message) => {
  const root = await fixture();
  const p = paths(root);
  await child(`
    import { readFileSync } from "node:fs";
    const { migrateStorageRoots } = await import(${JSON.stringify(engine)});
    await migrateStorageRoots([${JSON.stringify(root)}], () => {
      const state = JSON.parse(readFileSync(${JSON.stringify(p.state)}, "utf8"));
      if (state.phase === ${JSON.stringify(phase)}) {
        process.stdout.write(JSON.stringify({ stopped: state.phase }));
        process.exit(0);
      }
    });
    throw new Error("Expected migration interruption");
  `);
  const relative = join("payload", "file-00.bin");
  const original = await readFile(join(p.current, relative));
  const destination = damaged === "backup" ? join(p.originals, "current") : p.staging;
  await writeFile(join(destination, relative), "damaged after the process stopped");
  await expect(migrateStorageRoots([root], () => {})).rejects.toThrow(message);
  expect(await readFile(join(p.current, relative))).toEqual(original);
  expect(await Bun.file(p.accepted).exists()).toBe(false);
});

test("a corrupt second root prevents acceptance of every pending root and releases their locks", async () => {
  const first = await fixture();
  const second = await fixture();
  await migrateStorageRoots([first, second], () => {});
  const damaged = join(paths(second).current, "payload", "file-00.bin");
  const original = await readFile(damaged);
  await writeFile(damaged, "changed before acceptance");
  await expect(acceptStorageMigration([first, second])).rejects.toThrow(
    "Published storage failed hash verification",
  );
  for (const root of [first, second]) {
    expect(await Bun.file(paths(root).accepted).exists()).toBe(false);
    expect(await Bun.file(paths(root).lock).exists()).toBe(false);
  }
  await writeFile(damaged, original);
  await acceptStorageMigration([first, second]);
  for (const root of [first, second])
    expect(await Bun.file(paths(root).accepted).exists()).toBe(true);
});
