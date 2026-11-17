import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function project() {
  const directory = await mkdtemp(join(tmpdir(), "flecten-relocation-"));
  directories.push(directory);
  const original = join(directory, "original");
  await mkdir(original);
  return { original: await realpath(original), moved: join(await realpath(directory), "moved") };
}
async function file(root: string, path: string, text: string) {
  const location = join(root, path);
  await mkdir(dirname(location), { recursive: true });
  await writeFile(location, text);
}

test.each(["fresh", "migrated"])(
  "moving an accepted %s project verifies current data and requires separate acceptance",
  async (kind) => {
    const { original, moved } = await project();
    let state: string | undefined;
    if (kind === "fresh") await inspectStorageMigration([original]);
    else {
      await file(paths(original).legacy, "memory.json", "original memory");
      await migrateStorageRoots([original], progress);
      await acceptStorageMigration([original]);
      state = await readFile(paths(original).state, "utf8");
    }
    await file(paths(original).current, "memory.json", "latest runtime memory");
    const oldAcceptance = await readFile(paths(original).accepted, "utf8");
    await rename(original, moved);
    expect(await inspectStorageMigration([moved])).toEqual({ required: true });
    expect(await interruptedStorageMigration([moved])).toBe(false);
    await expect(acceptStorageMigration([moved])).rejects.toThrow("Verify relocated storage");
    await migrateStorageRoots([moved], progress);
    expect(await readFile(paths(moved).accepted, "utf8")).toBe(oldAcceptance);
    expect(await interruptedStorageMigration([moved])).toBe(true);
    // A restart resumes the same verified snapshot, without comparing it to an old merged plan.
    await migrateStorageRoots([moved], progress);
    expect(await realpath(paths(moved).legacy)).toBe(await realpath(paths(moved).current));
    await acceptStorageMigration([moved]);
    expect(await inspectStorageMigration([moved])).toEqual({ required: false });
    expect(JSON.parse(await readFile(paths(moved).accepted, "utf8")).root).toBe(
      await realpath(moved),
    );
    expect(await readFile(join(paths(moved).current, "memory.json"), "utf8")).toBe(
      "latest runtime memory",
    );
    if (state) {
      expect(await readFile(paths(moved).state, "utf8")).toBe(state);
      expect(await readFile(join(paths(moved).originals, "legacy/memory.json"), "utf8")).toBe(
        "original memory",
      );
    }
  },
);

test("relocation detects changes after verification and never accepts or replaces them", async () => {
  const { original, moved } = await project();
  await inspectStorageMigration([original]);
  await file(paths(original).current, "memory.json", "before");
  await rename(original, moved);
  await migrateStorageRoots([moved], progress);
  await file(paths(moved).current, "memory.json", "changed after verification");
  await expect(acceptStorageMigration([moved])).rejects.toThrow("changed after verification");
  await expect(migrateStorageRoots([moved], progress)).rejects.toThrow(
    "changed after verification",
  );
  expect(JSON.parse(await readFile(paths(moved).accepted, "utf8")).root).toBe(original);
  expect(await readFile(join(paths(moved).current, "memory.json"), "utf8")).toBe(
    "changed after verification",
  );
});

test("relocation repairs the exact previous absolute compatibility alias without changing its target", async () => {
  const { original, moved } = await project();
  await inspectStorageMigration([original]);
  await rm(paths(original).legacy);
  await symlink(
    paths(original).current,
    paths(original).legacy,
    process.platform === "win32" ? "junction" : "dir",
  );
  await file(paths(original).current, "memory.json", "moved memory");
  await rename(original, moved);
  // The old location may be reused. Replacing the link must never touch that directory.
  await file(paths(original).current, "memory.json", "other project");
  await migrateStorageRoots([moved], progress);
  await acceptStorageMigration([moved]);
  expect(await realpath(paths(moved).legacy)).toBe(await realpath(paths(moved).current));
  expect(await readFile(join(paths(original).current, "memory.json"), "utf8")).toBe(
    "other project",
  );
  expect(await readFile(join(paths(moved).current, "memory.json"), "utf8")).toBe("moved memory");
});

test("a moved acceptance never authorizes an unrelated compatibility alias", async () => {
  const { original, moved } = await project();
  await inspectStorageMigration([original]);
  await rename(original, moved);
  await rm(paths(moved).legacy);
  await file(original, "memory.json", "unrelated data");
  await symlink(original, paths(moved).legacy, process.platform === "win32" ? "junction" : "dir");
  const target = await readlink(paths(moved).legacy);
  await expect(migrateStorageRoots([moved], progress)).rejects.toThrow("Unsafe legacy alias");
  expect(await readlink(paths(moved).legacy)).toBe(target);
  expect(await readFile(join(original, "memory.json"), "utf8")).toBe("unrelated data");
  expect(JSON.parse(await readFile(paths(moved).accepted, "utf8")).root).toBe(original);
});

test("interruption while repairing a moved junction preserves its link and resumes safely", async () => {
  const { original, moved } = await project();
  await inspectStorageMigration([original]);
  await rm(paths(original).legacy);
  await symlink(
    paths(original).current,
    paths(original).legacy,
    process.platform === "win32" ? "junction" : "dir",
  );
  const target = await readlink(paths(original).legacy);
  await rename(original, moved);
  const instance = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { mock } from "bun:test";
    const actual = { ...await import("node:fs/promises") };
    mock.module("node:fs/promises", () => ({ ...actual, symlink: async (...args) => {
      if (args[1] === ${JSON.stringify(paths(moved).legacy)}) throw new Error("interrupted alias repair");
      return actual.symlink(...args);
    } }));
    const { migrateStorageRoots } = await import(${JSON.stringify(resolve("src/store/storage-migration/index.ts"))});
    try { await migrateStorageRoots([${JSON.stringify(moved)}], () => {}); process.exit(99); }
    catch (error) { process.stdout.write(error.message); }
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    instance.exited,
    new Response(instance.stdout).text(),
    new Response(instance.stderr).text(),
  ]);
  expect(code).toBe(0);
  expect(stdout).toBe("interrupted alias repair");
  expect(stderr).toBe("");
  const { readdir } = await import("node:fs/promises");
  const archived = (await readdir(paths(moved).transaction)).find((name) =>
    name.endsWith("-legacy"),
  );
  expect(archived).toBeDefined();
  expect(await readlink(join(paths(moved).transaction, archived ?? ""))).toBe(target);
  await migrateStorageRoots([moved], progress);
  await acceptStorageMigration([moved]);
  expect(await inspectStorageMigration([moved])).toEqual({ required: false });
});

test("an unaccepted transaction cannot be rebound by moving its files", async () => {
  const { original, moved } = await project();
  await file(paths(original).legacy, "memory.json", "original");
  await migrateStorageRoots([original], progress);
  await rename(original, moved);
  await expect(inspectStorageMigration([moved])).rejects.toThrow("different root");
  await expect(migrateStorageRoots([moved], progress)).rejects.toThrow("different root");
  expect(await readFile(join(paths(moved).originals, "legacy/memory.json"), "utf8")).toBe(
    "original",
  );
});
