import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWorkspaceFiles } from "../../src/app/workspace";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-files-"));
  dirs.push(cwd);
  await mkdir(join(cwd, "src"), { recursive: true });
  await mkdir(join(cwd, "node_modules", "ignored"), { recursive: true });
  await writeFile(join(cwd, "src", "main.ts"), "export const main = 1;\n");
  await writeFile(join(cwd, "README.md"), "# test\n");
  await writeFile(join(cwd, "node_modules", "ignored", "index.js"), "ignored\n");
  return cwd;
}

describe("workspace file list", () => {
  test("lists files relative to the project root", async () => {
    const cwd = await fixture();
    const files = await listWorkspaceFiles(cwd);
    expect(files).toContain("src/main.ts");
    expect(files).toContain("README.md");
    expect(files.every((path) => !path.startsWith("/"))).toBe(true);
  });

  test("uses git's ignore rules when the directory is a repository", async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, ".gitignore"), "node_modules/\n*.log\n");
    const init = Bun.spawn(["git", "init", "-q"], { cwd, stdout: "ignore", stderr: "ignore" });
    await init.exited;
    const files = await listWorkspaceFiles(cwd);
    expect(files).toContain("src/main.ts");
    expect(files.some((path) => path.startsWith("node_modules/"))).toBe(false);
  });
});
