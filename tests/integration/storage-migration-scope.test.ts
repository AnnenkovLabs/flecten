import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { manifest } from "../../src/store/storage-migration/fs";
import { migrateStorageRoots } from "../../src/store/storage-migration/index";
import { paths } from "../../src/store/storage-migration/state";

const directories: string[] = [];
const engine = resolve("src/store/storage-migration/index.ts");
const bootstrap = resolve("src/app/storage-bootstrap.ts");
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function root() {
  const directory = await mkdtemp(join(tmpdir(), "flecten-migration-scope-"));
  directories.push(directory);
  return directory;
}

async function file(directory: string, path: string, content: string) {
  await mkdir(dirname(join(directory, path)), { recursive: true });
  await writeFile(join(directory, path), content);
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

test("migration preserves rebuildable originals by rename without walking, hashing or copying them", async () => {
  const directory = await root();
  const p = paths(directory);
  const durable = "checkpoint bytes that must survive";
  await file(p.current, "checkpoints/objects/important", durable);
  const originals = [];
  for (const derived of ["shadow", "cache", "diagnostics"]) {
    const path = `${derived}/nested/large.bin`;
    const content = `original ${derived} bytes`;
    await file(p.current, path, content);
    originals.push({ path, content, inode: (await stat(join(p.current, path))).ino });
  }
  const result = await child(`
    import { mock } from "bun:test";
    import { sep } from "node:path";
    const actual = { ...await import("node:fs/promises") };
    let derivedOperations = 0;
    const tracked = (path) => {
      const parts = String(path).split(sep);
      if (parts.some((part) => ["shadow", "cache", "diagnostics"].includes(part))) derivedOperations++;
    };
    mock.module("node:fs/promises", () => ({ ...actual,
      lstat: async (path, ...args) => { tracked(path); return actual.lstat(path, ...args); },
      readdir: async (path, ...args) => { tracked(path); return actual.readdir(path, ...args); },
      open: async (path, ...args) => { tracked(path); return actual.open(path, ...args); },
    }));
    const { migrateStorageRoots, acceptStorageMigration } = await import(${JSON.stringify(engine)});
    await migrateStorageRoots([${JSON.stringify(directory)}], () => {});
    await acceptStorageMigration([${JSON.stringify(directory)}]);
    process.stdout.write(JSON.stringify({ derivedOperations }));
  `);
  expect(result.derivedOperations).toBe(0);
  expect(await readFile(join(p.current, "checkpoints/objects/important"), "utf8")).toBe(durable);
  for (const original of originals) {
    const retired = join(p.transaction, "retired-current", original.path);
    expect(await readFile(retired, "utf8")).toBe(original.content);
    expect((await stat(retired)).ino).toBe(original.inode);
    expect(await Bun.file(join(p.current, original.path)).exists()).toBe(false);
    expect(await Bun.file(join(p.originals, "current", original.path)).exists()).toBe(false);
  }
});

test("migration discovers only selected and remembered roots and never opens workspace siblings", async () => {
  const directory = await root();
  const profile = await root();
  const remembered = await root();
  const nested = join(directory, "projects", "unselected");
  const siblingData = join(directory, "datasets", "unrelated.bin");
  await file(directory, ".liquid/memory.json", "selected project data");
  await file(nested, ".liquid/memory.json", "another project's untouched data");
  await file(directory, "datasets/unrelated.bin", "large unrelated dataset");
  await file(remembered, ".liquid/memory.json", "remembered project data");
  await file(
    profile,
    "projects.json",
    JSON.stringify({
      version: 1,
      selected: directory,
      projects: [{ path: remembered, name: "remembered", trust: "unknown" }],
    }),
  );
  const result = await child(`
    import { mock } from "bun:test";
    import { relative, isAbsolute, sep } from "node:path";
    const actual = { ...await import("node:fs/promises") };
    const forbidden = ${JSON.stringify([nested, dirname(siblingData)])};
    const check = (path) => {
      for (const root of forbidden) {
        const within = relative(root, String(path));
        if (!within || (within !== ".." && !within.startsWith(".." + sep) && !isAbsolute(within)))
          throw new Error("Migration accessed an unrelated workspace path: " + path);
      }
    };
    mock.module("node:fs/promises", () => ({ ...actual,
      lstat: async (path, ...args) => { check(path); return actual.lstat(path, ...args); },
      readdir: async (path, ...args) => { check(path); return actual.readdir(path, ...args); },
      open: async (path, ...args) => { check(path); return actual.open(path, ...args); },
    }));
    delete process.env.FLECTEN_CONFIG;
    delete process.env.LIQUID_CONFIG;
    process.env.FLECTEN_PROFILE = ${JSON.stringify(profile)};
    const { storageRoots } = await import(${JSON.stringify(bootstrap)});
    const { migrateStorageRoots, acceptStorageMigration } = await import(${JSON.stringify(engine)});
    const roots = await storageRoots(${JSON.stringify(directory)});
    await migrateStorageRoots(roots, () => {});
    await acceptStorageMigration(roots);
    process.stdout.write(JSON.stringify({ roots }));
  `);
  expect(result.roots).toEqual([directory, profile, join(profile, "projectless"), remembered]);
  expect(await readFile(join(nested, ".liquid/memory.json"), "utf8")).toBe(
    "another project's untouched data",
  );
  expect(await readFile(siblingData, "utf8")).toBe("large unrelated dataset");
  expect(await Bun.file(join(nested, ".flecten-migration/v1/accepted.json")).exists()).toBe(false);
});

test("an old transaction already retiring still verifies all original bytes", async () => {
  const directory = await root();
  const p = paths(directory);
  await file(p.current, "memory.json", "durable memory");
  await file(p.current, "shadow/objects/original", "old shadow bytes");
  const entries = await manifest(p.current);
  await cp(p.current, join(p.originals, "current"), { recursive: true });
  await file(p.staging, "memory.json", "durable memory");
  await file(
    p.transaction,
    "state.json",
    JSON.stringify({
      version: 1,
      root: directory,
      phase: "retiring",
      alias: false,
      sources: [{ name: "current", entries }],
      merged: await manifest(p.staging),
    }),
  );
  await migrateStorageRoots([directory], () => {});
  expect(await manifest(join(p.originals, "current"))).toEqual(entries);
  const saved = JSON.parse(await readFile(p.state, "utf8"));
  expect(saved.sources[0].scope).toBe("full");
  expect(saved.revision).toBe(0);
});

test.each(["planned", "backed-up", "merged", "verified"])(
  "an old %s transaction restarts with a durable revision without reading derived trees",
  async (phase) => {
    const directory = await root();
    const p = paths(directory);
    await file(p.current, "memory.json", "original memory");
    await file(p.current, "shadow/objects/original", "huge old shadow bytes");
    await file(p.originals, "current/shadow/objects/partial", "partial old backup bytes");
    const partial = join(p.originals, "current/shadow/objects/partial");
    const partialInode = (await stat(partial)).ino;
    const raw = `${JSON.stringify({
      version: 1,
      root: directory,
      phase,
      alias: false,
      sources: [{ name: "current", entries: await manifest(p.current) }],
    })}\n`;
    await file(p.transaction, "state.json", raw);
    const result = await child(`
      import { mock } from "bun:test";
      import { sep } from "node:path";
      const actual = { ...await import("node:fs/promises") };
      let derivedOperations = 0;
      const tracked = (path) => {
        if (String(path).split(sep).some((part) => ["shadow", "cache", "diagnostics"].includes(part)))
          derivedOperations++;
      };
      mock.module("node:fs/promises", () => ({ ...actual,
        lstat: async (path, ...args) => { tracked(path); return actual.lstat(path, ...args); },
        readdir: async (path, ...args) => { tracked(path); return actual.readdir(path, ...args); },
        open: async (path, ...args) => { tracked(path); return actual.open(path, ...args); },
      }));
      const { migrateStorageRoots, acceptStorageMigration } = await import(${JSON.stringify(engine)});
      await migrateStorageRoots([${JSON.stringify(directory)}], () => {});
      await acceptStorageMigration([${JSON.stringify(directory)}]);
      process.stdout.write(JSON.stringify({ derivedOperations }));
    `);
    expect(result.derivedOperations).toBe(0);
    expect(await readFile(partial, "utf8")).toBe("partial old backup bytes");
    expect((await stat(partial)).ino).toBe(partialInode);
    expect(await readFile(join(p.transaction, "state-0-full.json"), "utf8")).toBe(raw);
    expect(await readFile(join(p.transaction, "originals-1/current/memory.json"), "utf8")).toBe(
      "original memory",
    );
    expect(await readFile(join(p.current, "memory.json"), "utf8")).toBe("original memory");
    const saved = JSON.parse(await readFile(p.state, "utf8"));
    expect(saved.revision).toBe(1);
    expect(saved.sources[0].scope).toBe("durable");
  },
);

test("a restart between archiving the full plan and publishing its durable revision reuses the archive", async () => {
  const directory = await root();
  const p = paths(directory);
  await file(p.current, "memory.json", "original memory");
  const raw = JSON.stringify({
    version: 1,
    root: directory,
    phase: "planned",
    alias: false,
    sources: [{ name: "current", entries: await manifest(p.current) }],
  });
  await file(p.transaction, "state.json", raw);
  const archive = join(p.transaction, "state-0-full.json");
  const result = await child(`
    import { mock } from "bun:test";
    const actual = { ...await import("node:fs/promises") };
    mock.module("node:fs/promises", () => ({ ...actual, rename: async (source, target) => {
      if (target === ${JSON.stringify(p.state)} && await Bun.file(${JSON.stringify(archive)}).exists())
        throw new Error("interrupted after archive");
      return actual.rename(source, target);
    } }));
    const { migrateStorageRoots } = await import(${JSON.stringify(engine)});
    try { await migrateStorageRoots([${JSON.stringify(directory)}], () => {}); }
    catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); }
  `);
  expect(result.error).toBe("interrupted after archive");
  const inode = (await stat(archive)).ino;
  expect(await readFile(p.state, "utf8")).toBe(raw);
  await migrateStorageRoots([directory], () => {});
  expect(await readFile(archive, "utf8")).toBe(raw);
  expect((await stat(archive)).ino).toBe(inode);
  expect(JSON.parse(await readFile(p.state, "utf8")).revision).toBe(1);
});

test("resuming retirement never deletes rebuildable originals when durable retired data changed", async () => {
  const directory = await root();
  const p = paths(directory);
  await file(p.current, "memory.json", "original memory");
  await file(p.current, "shadow/objects/original", "original shadow bytes");
  const retired = join(p.transaction, "retired-current");
  await child(`
    import { mock } from "bun:test";
    const actual = { ...await import("node:fs/promises") };
    mock.module("node:fs/promises", () => ({ ...actual, rename: async (source, target) => {
      await actual.rename(source, target);
      if (target === ${JSON.stringify(retired)}) {
        process.stdout.write(JSON.stringify({ stopped: true }));
        process.exit(0);
      }
    } }));
    const { migrateStorageRoots } = await import(${JSON.stringify(engine)});
    await migrateStorageRoots([${JSON.stringify(directory)}], () => {});
    throw new Error("Expected interruption after retirement rename");
  `);
  const inode = (await stat(join(retired, "shadow/objects/original"))).ino;
  await writeFile(join(retired, "memory.json"), "changed retired memory");
  await expect(migrateStorageRoots([directory], () => {})).rejects.toThrow(
    "Preserve its rebuildable originals",
  );
  expect(await readFile(join(retired, "memory.json"), "utf8")).toBe("changed retired memory");
  expect(await readFile(join(retired, "shadow/objects/original"), "utf8")).toBe(
    "original shadow bytes",
  );
  expect((await stat(join(retired, "shadow/objects/original"))).ino).toBe(inode);
});
