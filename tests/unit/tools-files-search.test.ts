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
  const dir = await mkdtemp(join(tmpdir(), "flecten-tools-search-"));
  dirs.push(dir);
  return dir;
}

function context(cwd: string): ToolContext {
  return {
    sessionId: "s_test",
    cwd,
    signal: new AbortController().signal,
    logDir: join(cwd, ".flecten/logs"),
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
  test("hidden searches keep immutable migration originals out of model results", async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, ".flecten-migration/v1/originals"), { recursive: true });
    await writeFile(join(cwd, ".flecten-migration/v1/originals/secrets.json"), "migration-secret");
    await writeFile(join(cwd, "public.txt"), "migration-secret");
    for (const search of [runGrep, runGrepFallback]) {
      const result = await search({ pattern: "migration-secret", hidden: true }, context(cwd));
      expect(result.output).toContain("public.txt");
      expect(result.output).not.toContain(".flecten-migration");
    }
    for (const glob of [runGlob, runGlobFallback]) {
      const result = await glob({ pattern: "**/*", hidden: true }, context(cwd));
      expect(result.output).not.toContain(".flecten-migration");
    }
  });
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

  test("auto-expands top definition body when context is omitted and deduplicates on repeat search (KV-cache safe)", async () => {
    const cwd = await tempDir();
    const source = [
      "export function verifyAuthToken(raw: string): boolean {",
      "  const trimmed = raw.trim();",
      "  return trimmed.startsWith('Bearer ');",
      "}",
      "",
    ].join("\n");
    await writeFile(join(cwd, "auth.ts"), source);
    const ctx = context(cwd);

    // First search without context: expands the compact definition body in standard ripgrep format
    const first = await runGrep({ pattern: "verifyAuthToken" }, ctx);
    expect(first.ok).toBe(true);
    expect(first.output).toContain("auth.ts:1: export function verifyAuthToken");
    expect(first.output).toContain("auth.ts-2-   const trimmed = raw.trim();");
    expect(first.output).toContain("auth.ts-4- }");

    // Second search in same session: deduplicates the already-shown body while keeping the match line
    const second = await runGrep({ pattern: "verifyAuthToken" }, ctx);
    expect(second.ok).toBe(true);
    expect(second.output).toContain("auth.ts:1: export function verifyAuthToken");
    expect(second.output).not.toContain("auth.ts-2-   const trimmed = raw.trim();");
  });

  test("rg-accelerated BM25 fallback finds multi-term camelCase hits when exact regex misses", async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, "process-tree.ts"),
      [
        "export function killTerminalSubprocessTree(pid: number): void {",
        "  process.kill(pid, 'SIGKILL');",
        "}",
      ].join("\n"),
    );
    const res = await runGrep({ pattern: "terminal kill tree" }, context(cwd));
    expect(res.ok).toBe(true);
    expect(res.output).toContain("process-tree.ts:1: export function killTerminalSubprocessTree");
    expect(res.output).toContain("[No exact regex matches; showing BM25 identifier matches]");
  });

  test("literal=true stays exact and does not trigger fuzzy BM25 fallback", async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, "process-tree.ts"),
      "export function killTerminalSubprocessTree(pid: number): void {}\n",
    );
    for (const search of [runGrep, runGrepFallback]) {
      const res = await search({ pattern: "terminal kill tree", literal: true }, context(cwd));
      expect(res.ok).toBe(true);
      expect(res.output).toBe("No matches found");
      expect(res.data).toMatchObject({ kind: "search", count: 0 });
    }
  });

  test("BM25 prefilter ignores stopwords and prioritizes src/ over >250 earlier docs files", async () => {
    const cwd = await tempDir();
    await mkdir(join(cwd, "docs"), { recursive: true });
    await mkdir(join(cwd, "src"), { recursive: true });
    await Promise.all(
      Array.from({ length: 260 }, (_, idx) =>
        writeFile(
          join(cwd, "docs", `doc-${String(idx).padStart(3, "0")}.md`),
          "How to configure unrelated auth settings.\n",
        ),
      ),
    );
    await writeFile(
      join(cwd, "src", "session-token.ts"),
      [
        "export function verifySessionAuthToken(raw: string): boolean {",
        "  return raw.startsWith('Bearer ');",
        "}",
      ].join("\n"),
    );
    const res = await runGrep({ pattern: "how to verify session token" }, context(cwd));
    expect(res.ok).toBe(true);
    expect(res.output).toContain("src/session-token.ts:1: export function verifySessionAuthToken");
    expect(res.output).toContain("[No exact regex matches; showing BM25 identifier matches]");
  });

  test("multiline=true matches across line breaks identically in ripgrep and fallback", async () => {
    const cwd = await tempDir();
    await writeFile(
      join(cwd, "sig.ts"),
      [
        "export async function startWorker(",
        "  brief: string,",
        "  timeoutMs: number,",
        "): Promise<void> {",
        "  return undefined;",
        "}",
      ].join("\n"),
    );
    for (const search of [runGrep, runGrepFallback]) {
      const regexRes = await search(
        { pattern: "startWorker\\(.*timeoutMs: number", multiline: true },
        context(cwd),
      );
      expect(regexRes.ok).toBe(true);
      expect(regexRes.output).toContain("sig.ts:1: export async function startWorker(");
      expect(regexRes.output).toContain("sig.ts:2:   brief: string,");
      expect(regexRes.output).toContain("sig.ts:3:   timeoutMs: number,");

      const literalRes = await search(
        { pattern: "brief: string,\n  timeoutMs: number,", literal: true, multiline: true },
        context(cwd),
      );
      expect(literalRes.ok).toBe(true);
      expect(literalRes.output).toContain("sig.ts:2:   brief: string,");
      expect(literalRes.output).toContain("sig.ts:3:   timeoutMs: number,");
    }
  });

  test("external absolute directory grep expands definitions and primes ReadTracker", async () => {
    const cwd = await tempDir();
    const external = await tempDir();
    const target = join(external, "widget.ts");
    const source = [
      "export function computeWidgetScore(input: number): number {",
      "  return input * 2;",
      "}",
      "",
    ].join("\n");
    await writeFile(target, source);
    for (const search of [runGrep, runGrepFallback]) {
      const ctx = context(cwd);
      const res = await search({ pattern: "computeWidgetScore", path: external }, ctx);
      expect(res.ok).toBe(true);
      expect(res.output).toContain("export function computeWidgetScore");
      expect(res.output).toContain("return input * 2;");
      expect(ctx.reads.verify(target, source)).toBe("ok");
    }
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
    expect(result.data).toMatchObject({ count: 2, total: 3, nextOffset: 2 });
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
