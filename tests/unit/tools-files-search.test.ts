import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGlob, runGlobFallback } from "../../src/tools/glob/run";
import { runGrep, runGrepFallback } from "../../src/tools/grep/run";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-tools-search-"));
  dirs.push(dir);
  return dir;
}

function context(cwd: string): ToolContext {
  return {
    sessionId: "s_test",
    cwd,
    signal: new AbortController().signal,
    logDir: join(cwd, ".liquid/logs"),
    limits,
    reads: new ReadTracker(),
  };
}

function makeFifo(path: string): boolean {
  if (process.platform === "win32") return false;
  const result = Bun.spawnSync({ cmd: ["mkfifo", path] });
  return result.exitCode === 0;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("grep flags", () => {
  test("honors case sensitivity", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "Needle\nneedle\n");
    const insensitive = await runGrepFallback(
      { pattern: "needle", caseSensitive: false },
      context(cwd),
    );
    expect(insensitive.ok).toBe(true);
    expect(insensitive.output).toContain("a.ts:1");
    expect(insensitive.output).toContain("a.ts:2");

    const sensitive = await runGrepFallback({ pattern: "needle" }, context(cwd));
    expect(sensitive.output).not.toContain("a.ts:1");
    expect(sensitive.output).toContain("a.ts:2");
  });

  test("prints context lines around matches", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "aa\nbb\ncc\ndd\n");
    const result = await runGrepFallback({ pattern: "cc", context: 1 }, context(cwd));
    expect(result.output).toContain("a.ts-2- bb");
    expect(result.output).toContain("a.ts:3: cc");
    expect(result.output).toContain("a.ts-4- dd");
  });

  test("returns per-file counts and files with matches", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "needle\nneedle\nother\n");
    await writeFile(join(cwd, "b.ts"), "other\n");

    const counted = await runGrepFallback({ pattern: "needle", count: true }, context(cwd));
    expect(counted.output).toBe("a.ts:2");

    const files = await runGrepFallback(
      { pattern: "needle", filesWithMatches: true },
      context(cwd),
    );
    expect(files.output).toBe("a.ts");
  });

  test("includes hidden files only when asked", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, ".hidden.ts"), "needle\n");
    const hidden = await runGrepFallback({ pattern: "needle", hidden: true }, context(cwd));
    expect(hidden.output).toContain(".hidden.ts");

    const plain = await runGrepFallback({ pattern: "needle" }, context(cwd));
    expect(plain.output).toContain("No matches found");
  });

  test("filters by file type", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "needle\n");
    await writeFile(join(cwd, "b.md"), "needle\n");
    const result = await runGrepFallback({ pattern: "needle", type: "ts" }, context(cwd));
    expect(result.output).toContain("a.ts");
    expect(result.output).not.toContain("b.md");
  });

  test("skips a FIFO without hanging", async () => {
    const cwd = await tempDir();
    const fifo = join(cwd, "pipe");
    if (!makeFifo(fifo)) return;
    await writeFile(join(cwd, "a.ts"), "needle\n");
    const result = await runGrepFallback({ pattern: "needle" }, context(cwd));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.ts");
  });

  test("reports truncation and honors .gitignore in the fallback", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, ".gitignore"), "ignored.ts\nskip/\n");
    await writeFile(join(cwd, "a.ts"), "needle\n");
    await writeFile(join(cwd, "b.ts"), "needle\n");
    await writeFile(join(cwd, "ignored.ts"), "needle\n");
    await mkdir(join(cwd, "skip"));
    await writeFile(join(cwd, "skip", "c.ts"), "needle\n");

    const limited = await runGrepFallback({ pattern: "needle", maxResults: 1 }, context(cwd));
    expect(limited.output).toContain("a.ts");
    expect(limited.output).not.toContain("b.ts");
    expect(limited.output).not.toContain("ignored.ts");
    expect(limited.output).toContain("limit reached");

    const all = await runGrepFallback({ pattern: "needle" }, context(cwd));
    expect(all.output).not.toContain("ignored.ts");
    expect(all.output).not.toContain("skip/c.ts");
  });

  test("runs through the product path with flags", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "a.ts"), "Needle\nneedle\n");
    await writeFile(join(cwd, "b.md"), "needle\n");
    const result = await runGrep(
      { pattern: "needle", caseSensitive: false, type: "ts", count: true },
      context(cwd),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe("a.ts:2");
  });
});

describe("glob fallback", () => {
  test("native scan paths share filtering and display rules when searching a nested directory", async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, "pkg", "src"), { recursive: true });
    await mkdir(join(cwd, "pkg", "dist"));
    await writeFile(join(cwd, "pkg", ".gitignore"), "/src/ignored.ts\n");
    await writeFile(join(cwd, "pkg", "src", "keep.ts"), "needle\n");
    await writeFile(join(cwd, "pkg", "src", "ignored.ts"), "needle\n");
    await writeFile(join(cwd, "pkg", "dist", "output.ts"), "needle\n");

    for (const result of [
      await runGlob({ pattern: "*.ts", path: "pkg" }, context(cwd)),
      await runGlobFallback({ pattern: "*.ts", path: "pkg" }, context(cwd)),
      await runGrepFallback(
        { pattern: "needle", path: "pkg", filesWithMatches: true },
        context(cwd),
      ),
    ]) {
      expect(result.ok).toBe(true);
      expect(result.output).toBe("pkg/src/keep.ts");
    }
  });

  test("applies nested ignore scopes and cannot reinclude an excluded directory", async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, "pkg", "skip"), { recursive: true });
    await mkdir(join(cwd, "other"));
    await writeFile(join(cwd, ".gitignore"), "*.ts\n!other/*.ts\n");
    await writeFile(
      join(cwd, "pkg", ".gitignore"),
      "!keep.ts\n/anchored.ts\nskip/\n!skip/revive.ts\n",
    );
    for (const path of [
      "root.ts",
      "pkg/hidden.ts",
      "pkg/keep.ts",
      "pkg/anchored.ts",
      "pkg/skip/revive.ts",
      "other/keep.ts",
    ]) {
      await writeFile(join(cwd, path), "needle\n");
    }
    const glob = await runGlobFallback({ pattern: "*.ts" }, context(cwd));
    const grep = await runGrepFallback({ pattern: "needle", filesWithMatches: true }, context(cwd));
    for (const result of [glob, grep]) {
      expect(result.ok).toBe(true);
      expect(result.output).toBe("other/keep.ts\npkg/keep.ts");
    }
    for (const result of [
      await runGlobFallback({ pattern: "*.ts", path: "pkg" }, context(cwd)),
      await runGrepFallback(
        { pattern: "needle", path: "pkg", filesWithMatches: true },
        context(cwd),
      ),
    ]) {
      expect(result.ok).toBe(true);
      expect(result.output).toBe("pkg/keep.ts");
    }
  });

  test("honors .gitignore and negation", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, ".gitignore"), "*.ts\n!keep.ts\n");
    await writeFile(join(cwd, "a.ts"), "");
    await writeFile(join(cwd, "keep.ts"), "");
    const result = await runGlobFallback({ pattern: "*.ts" }, context(cwd));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("keep.ts");
    expect(result.output).not.toContain("a.ts");
  });

  test("sorts deterministically and reports truncation", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "c.ts"), "");
    await writeFile(join(cwd, "a.ts"), "");
    await writeFile(join(cwd, "b.ts"), "");
    const result = await runGlobFallback({ pattern: "*.ts", maxResults: 2 }, context(cwd));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Showing 2 of 3 files");
    expect(result.output.indexOf("a.ts")).toBeLessThan(result.output.indexOf("b.ts"));
    expect(result.output).not.toContain("c.ts");
  });

  test("honors .gitignore through the product path", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, ".gitignore"), "ignored.ts\n");
    await writeFile(join(cwd, "a.ts"), "");
    await writeFile(join(cwd, "ignored.ts"), "");
    const result = await runGlob({ pattern: "*.ts" }, context(cwd));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("a.ts");
    expect(result.output).not.toContain("ignored.ts");
  });
});
