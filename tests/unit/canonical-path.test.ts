import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDataDirectory } from "../../src/config/data-directory";
import { SandboxPolicy } from "../../src/security/sandbox";
import { inspectStorageMigration } from "../../src/store/storage-migration";
import { canonicalPath } from "../../src/util/canonical-path";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("accepted canonical storage reopens through both temporary and native paths", async () => {
  const base = await mkdtemp(join(tmpdir(), "flecten-canonical-reopen-"));
  directories.push(base);
  await inspectStorageMigration([base]);
  await writeFile(join(base, ".flecten", "retained.txt"), "retained bytes");
  for (const root of [base, await realpath(base)]) {
    expect(() => migrateDataDirectory(root)).not.toThrow();
    expect(await readFile(join(root, ".liquid", "retained.txt"), "utf8")).toBe("retained bytes");
  }
});

test("canonical paths resolve aliases and missing descendants with the native real path", async () => {
  const base = await mkdtemp(join(tmpdir(), "flecten-canonical-"));
  directories.push(base);
  const target = join(base, "project");
  const alias = join(base, "alias");
  await mkdir(target);
  await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
  const actual = await realpath(target);
  expect(canonicalPath(alias)).toBe(actual);
  expect(canonicalPath(join(alias, "missing", "file.txt"))).toBe(
    join(actual, "missing", "file.txt"),
  );
});

test.skipIf(process.platform !== "win32")(
  "Windows temp aliases and async realpath keep the same sandbox boundary",
  async () => {
    // Windows runners expose TEMP through RUNNER~1 while async realpath expands runneradmin.
    const base = await mkdtemp(join(tmpdir(), "flecten-canonical-windows-"));
    directories.push(base);
    const root = join(base, "project");
    const outside = join(base, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(root, "file.txt"), "inside");
    await writeFile(join(root, ".env"), "protected");
    await symlink(outside, join(root, "escape"), "junction");
    const actual = await realpath(root);
    expect(canonicalPath(root)).toBe(actual);
    expect(canonicalPath(join(root, "missing", "file.txt"))).toBe(
      join(actual, "missing", "file.txt"),
    );
    for (const workspaceRoot of [root, actual]) {
      const sandbox = new SandboxPolicy({ workspaceRoot });
      for (const pathRoot of [root, actual]) {
        expect((await sandbox.checkRead(join(pathRoot, "file.txt"))).allowed).toBe(true);
        expect((await sandbox.checkWrite(join(pathRoot, "new", "file.txt"))).allowed).toBe(true);
        expect((await sandbox.checkRead(join(pathRoot, ".env"))).allowed).toBe(false);
        expect((await sandbox.checkWrite(join(pathRoot, ".git", "config"))).allowed).toBe(false);
        expect((await sandbox.checkWrite(join(pathRoot, "escape", "file.txt"))).allowed).toBe(
          false,
        );
      }
    }
  },
);
