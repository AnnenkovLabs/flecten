import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "../../src/tools/git/run";
import { gitSpec } from "../../src/tools/git/schema";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-git-"));
  dirs.push(dir);
  return dir;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout;
}

async function repo(): Promise<string> {
  const cwd = await tempDir();
  await git(cwd, "init", "-q");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "user.name", "Test User");
  await git(cwd, "config", "commit.gpgsign", "false");
  await writeFile(join(cwd, "a.txt"), "one\n");
  await git(cwd, "add", "a.txt");
  await git(cwd, "commit", "-m", "initial");
  return cwd;
}

function context(cwd: string) {
  return { cwd, signal: new AbortController().signal };
}

interface GitData {
  kind: string;
  operation: string;
  command: string[];
  commandLine: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  linesOmitted: number;
  refused?: boolean;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("git schema", () => {
  test("rejects unknown and unsafe fields", () => {
    expect(gitSpec.schema.safeParse({ operation: "status" }).success).toBe(true);
    expect(
      gitSpec.schema.safeParse({ operation: "commit", message: "x", amend: true }).success,
    ).toBe(false);
    expect(gitSpec.schema.safeParse({ operation: "push" }).success).toBe(false);
  });
});

describe("git read operations", () => {
  test("status returns branch, changes and the exact command", async () => {
    const cwd = await repo();
    await writeFile(join(cwd, "b.txt"), "b\n");
    const result = await runGit({ operation: "status" }, context(cwd));
    const data = result.data as GitData;

    expect(result.ok).toBe(true);
    expect(data.command).toEqual([
      "git",
      "--no-pager",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "status",
      "--short",
      "--branch",
    ]);
    expect(data.exitCode).toBe(0);
    expect(result.output).toContain(
      "$ git --no-pager --no-optional-locks -c core.fsmonitor=false status --short --branch",
    );
    expect(result.output).toContain("exit code: 0");
    expect(result.output).toContain("?? b.txt");
  });

  test("diff supports staged, path and maxLines", async () => {
    const cwd = await repo();
    await writeFile(join(cwd, "a.txt"), "one\ntwo\nthree\nfour\n");
    await git(cwd, "add", "a.txt");
    const result = await runGit(
      { operation: "diff", staged: true, path: "a.txt", maxLines: 1 },
      context(cwd),
    );
    const data = result.data as GitData;

    expect(result.ok).toBe(true);
    expect(data.command).toEqual([
      "git",
      "--no-pager",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--cached",
      "--",
      "a.txt",
    ]);
    expect(data.linesOmitted).toBeGreaterThan(0);
    expect(data.truncated).toBe(true);
    expect(result.output).toContain("lines omitted; raise maxLines");
  });

  test("log honors maxCount", async () => {
    const cwd = await repo();
    await writeFile(join(cwd, "a.txt"), "two\n");
    await git(cwd, "add", "a.txt");
    await git(cwd, "commit", "-m", "second commit");

    const result = await runGit({ operation: "log", maxCount: 1 }, context(cwd));
    const data = result.data as GitData;

    expect(result.ok).toBe(true);
    expect(data.command).toEqual([
      "git",
      "--no-pager",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "log",
      "--max-count=1",
      "--oneline",
      "--decorate",
    ]);
    expect(result.output).toContain("second commit");
    expect(result.output).not.toContain("initial");
  });

  test("show returns a commit and branch lists the current branch", async () => {
    const cwd = await repo();
    const branch = (await git(cwd, "rev-parse", "--abbrev-ref", "HEAD")).trim();

    const shown = await runGit({ operation: "show" }, context(cwd));
    expect(shown.ok).toBe(true);
    expect(shown.output).toContain(
      "$ git --no-pager --no-optional-locks -c core.fsmonitor=false show --no-ext-diff --no-textconv --stat --patch HEAD",
    );
    expect(shown.output).toContain("initial");

    const branches = await runGit({ operation: "branch" }, context(cwd));
    expect(branches.ok).toBe(true);
    expect(branches.output).toContain(branch);
  });

  test("show rejects option-like revisions", async () => {
    const cwd = await repo();
    const result = await runGit({ operation: "show", rev: "--output=/tmp/leak" }, context(cwd));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not an option");
  });

  test("reports a missing repository without throwing", async () => {
    const cwd = await tempDir();
    const result = await runGit({ operation: "status" }, context(cwd));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("exited with code");
  });

  test("aborted context does not run git", async () => {
    const cwd = await repo();
    const controller = new AbortController();
    controller.abort();
    const result = await runGit({ operation: "status" }, { cwd, signal: controller.signal });
    const data = result.data as GitData;
    expect(result.ok).toBe(false);
    expect(data.exitCode).toBe(130);
    expect(result.error).toContain("aborted");
  });
});

describe("git commit guardrails", () => {
  test("requires allowCommit and a non-empty message", async () => {
    const cwd = await repo();
    await writeFile(join(cwd, "a.txt"), "two\n");
    await git(cwd, "add", "a.txt");

    const missingAllow = await runGit({ operation: "commit", message: "change" }, context(cwd));
    expect(missingAllow.ok).toBe(false);
    expect(missingAllow.error).toContain("allowCommit=true");

    const blank = await runGit(
      { operation: "commit", allowCommit: true, message: "   " },
      context(cwd),
    );
    expect(blank.ok).toBe(false);
    expect(blank.error).toContain("non-empty message");
  });

  test("refuses when nothing is staged", async () => {
    const cwd = await repo();
    await writeFile(join(cwd, "a.txt"), "unstaged\n");

    const result = await runGit(
      { operation: "commit", allowCommit: true, message: "should not land" },
      context(cwd),
    );
    const data = result.data as GitData;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No staged changes");
    expect(data.refused).toBe(true);
    expect(data.exitCode).toBeNull();
    expect(await git(cwd, "log", "-1", "--format=%s")).toContain("initial");
  });

  test("commits staged changes when allowed", async () => {
    const cwd = await repo();
    await writeFile(join(cwd, "a.txt"), "two\n");
    await git(cwd, "add", "a.txt");

    const result = await runGit(
      { operation: "commit", allowCommit: true, message: "update a" },
      context(cwd),
    );
    const data = result.data as GitData;

    expect(result.ok).toBe(true);
    expect(data.command).toEqual(["git", "commit", "-m", "update a"]);
    expect(data.exitCode).toBe(0);
    expect(result.output).toContain("$ git commit -m 'update a'");
    expect((await git(cwd, "log", "-1", "--format=%s")).trim()).toBe("update a");
  });
});
