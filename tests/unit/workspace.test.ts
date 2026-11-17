import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkspaceFiles } from "../../src/app/workspace";
import { searchWorkspace } from "../../src/app/workspace-search";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-files-"));
  dirs.push(cwd);
  await mkdir(join(cwd, "src"), { recursive: true });
  await mkdir(join(cwd, "node_modules", "ignored"), { recursive: true });
  await writeFile(join(cwd, "src", "main.ts"), "export const main = 1;\n");
  await writeFile(join(cwd, "README.md"), "# test\n");
  await writeFile(join(cwd, "node_modules", "ignored", "index.js"), "ignored\n");
  return cwd;
}

describe("workspace file list", () => {
  test("automatic indexing stops at a bounded depth", async () => {
    const cwd = await fixture();
    let directory = cwd;
    for (let depth = 0; depth < 40; depth += 1) {
      directory = join(directory, "nested");
      await mkdir(directory);
    }
    await writeFile(join(directory, "too-deep.txt"), "unrelated data");
    expect(
      (await listWorkspaceFiles(cwd)).files.some((path) => path.endsWith("too-deep.txt")),
    ).toBe(false);
  });

  test("project search reports an incomplete file index even without matches", async () => {
    const cwd = await fixture();
    await Promise.all(
      Array.from({ length: 5010 }, (_, index) => writeFile(join(cwd, `${index}.txt`), "")),
    );
    expect(await searchWorkspace(cwd, { query: "missing" })).toMatchObject({ limited: true });
  });

  test("lists files relative to the project root", async () => {
    const cwd = await fixture();
    const { files } = await listWorkspaceFiles(cwd);
    expect(files).toContain("src/main.ts");
    expect(files).toContain("README.md");
    expect(files.every((path) => !path.startsWith("/"))).toBe(true);
  });

  test("empty directory collections have a bounded index too", async () => {
    const cwd = await fixture();
    await Promise.all(
      Array.from({ length: 2010 }, (_, index) => mkdir(join(cwd, `folder-${index}`))),
    );
    const index = await listWorkspaceFiles(cwd);
    expect(index.limited).toBe(true);
    expect(index.directories.length).toBeLessThanOrEqual(2000);
  });

  test("git output stops at the file limit and reports incomplete indexing", async () => {
    const cwd = await fixture();
    await Promise.all(
      Array.from({ length: 5010 }, (_, index) => writeFile(join(cwd, `${index}.txt`), "")),
    );
    const init = Bun.spawn(["git", "init", "-q"], { cwd, stdout: "ignore", stderr: "ignore" });
    await init.exited;
    const index = await listWorkspaceFiles(cwd);
    expect(index.limited).toBe(true);
    expect(index.files.length).toBeLessThanOrEqual(5000);
  });

  test("uses git's ignore rules when the directory is a repository", async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, ".gitignore"), "node_modules/\n*.log\n");
    const init = Bun.spawn(["git", "init", "-q"], { cwd, stdout: "ignore", stderr: "ignore" });
    await init.exited;
    await mkdir(join(cwd, ".flecten-migration", "v1", "originals"), { recursive: true });
    await writeFile(join(cwd, ".flecten-migration", "v1", "originals", "secrets.json"), "private");
    const { files } = await listWorkspaceFiles(cwd);
    expect(files).toContain("src/main.ts");
    expect(files.some((path) => path.startsWith("node_modules/"))).toBe(false);
    expect(files.some((path) => path.includes(".flecten-migration"))).toBe(false);
  });
});
