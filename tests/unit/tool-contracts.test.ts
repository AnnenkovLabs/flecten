import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { SubagentRegistry } from "../../src/core/subagents/registry";
import { SubagentRunner } from "../../src/core/subagents/runner";
import type { SubagentSpec } from "../../src/core/subagents/types";
import { emptyUsage } from "../../src/core/types/message";
import { TerminalManager } from "../../src/terminal/manager";
import { builtinTools } from "../../src/tools/builtin";
import { runGlobFallback } from "../../src/tools/glob/run";
import { runGrepFallback } from "../../src/tools/grep/run";
import { ToolRegistry } from "../../src/tools/registry";
import type { TaskToolContext } from "../../src/tools/task/run";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const dirs: string[] = [];
const managers: TerminalManager[] = [];
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

async function context(): Promise<ToolContext> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-tool-contracts-"));
  dirs.push(cwd);
  return {
    sessionId: "s_contracts",
    cwd,
    signal: new AbortController().signal,
    logDir: join(cwd, ".liquid", "logs"),
    limits,
    reads: new ReadTracker(),
  };
}

function registry(): ToolRegistry {
  return new ToolRegistry(builtinTools(), { limits });
}

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.closeAll();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("search tool contracts", () => {
  test("literal searches preserve metacharacters through registry and fallback", async () => {
    const ctx = await context();
    await writeFile(join(ctx.cwd, "source.ts"), "value = [Needle](x)\nvalue = Needle\n");
    const args = { pattern: "[needle](x)", literal: true, caseSensitive: false };
    const result = await registry().run({ id: "literal", name: "grep", args }, ctx);
    const fallback = await runGrepFallback(args, ctx);
    for (const output of [result, fallback]) {
      expect(output.ok).toBe(true);
      expect(output.output).toContain("source.ts:1:");
      expect(output.data).toMatchObject({ kind: "search", count: 1 });
      expect(output.output).not.toContain("source.ts:2:");
    }
  });

  test("context lines cannot impersonate matches through a path (with colons on POSIX)", async () => {
    const ctx = await context();
    const name = process.platform === "win32" ? "part-12-source.ts" : "part:12:source.ts";
    await writeFile(join(ctx.cwd, name), "before\nneedle\nafter\nneedle\n");
    const result = await registry().run(
      { id: "context", name: "grep", args: { pattern: "needle", context: 1, maxResults: 1 } },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain(`${name}-1- before`);
    expect(result.output).toContain(`${name}:2: needle`);
    expect(result.output).toContain("limit reached");
    expect(result.data).toMatchObject({ count: 1 });
  });

  test("overlapping fallback context preserves matching-line markers", async () => {
    const ctx = await context();
    await writeFile(join(ctx.cwd, "source.ts"), "before\nneedle\nneedle\nafter\n");
    const result = await runGrepFallback({ pattern: "needle", context: 1 }, ctx);
    expect(result.output).toContain("source.ts:2: needle");
    expect(result.output).toContain("source.ts:3: needle");
    expect(result.data).toMatchObject({ count: 2 });
  });

  test("reports a single-file match limit instead of silently claiming complete output", async () => {
    const ctx = await context();
    await writeFile(join(ctx.cwd, "source.ts"), "needle\nneedle\n");
    const result = await registry().run(
      { id: "limit", name: "grep", args: { pattern: "needle", maxResults: 1 } },
      ctx,
    );
    expect(result.output).toContain("limit reached");
    expect(result.data).toMatchObject({ count: 1 });
  });

  test("an empty directory is a successful glob with no results", async () => {
    const ctx = await context();
    const result = await registry().run(
      { id: "empty", name: "glob", args: { pattern: "*.ts" } },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ kind: "glob", count: 0 });
  });

  test("hidden-file discovery works while generated directories remain excluded", async () => {
    const ctx = await context();
    await writeFile(join(ctx.cwd, ".hidden.ts"), "");
    await mkdir(join(ctx.cwd, "dist"));
    await writeFile(join(ctx.cwd, "dist", "output.ts"), "");
    const args = { pattern: "*.ts", hidden: true };
    const result = await registry().run({ id: "hidden", name: "glob", args }, ctx);
    const fallback = await runGlobFallback(args, ctx);
    for (const output of [result, fallback]) {
      expect(output.ok).toBe(true);
      expect(output.output).toContain(".hidden.ts");
      expect(output.output).not.toContain("dist/output.ts");
      expect(output.data).toMatchObject({ count: 1 });
    }
  });
});

describe("execution contracts", () => {
  test("invalid operations fail at the schema boundary before opening a terminal", async () => {
    const ctx = await context();
    const manager = new TerminalManager();
    managers.push(manager);
    ctx.terminals = manager;
    for (const args of [{ op: "run" }, { op: "write" }, { op: "resize" }]) {
      const result = await registry().run({ id: "invalid", name: "terminal", args }, ctx);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Invalid arguments");
    }
    expect(manager.list()).toHaveLength(0);
    const job = await registry().run({ id: "job", name: "jobs", args: { op: "wait" } }, ctx);
    expect(job.error).toContain("wait needs id");
  });

  test("a failed PTY command is returned as failure with its real exit code", async () => {
    const ctx = await context();
    const manager = new TerminalManager();
    managers.push(manager);
    ctx.terminals = manager;
    const result = await registry().run(
      { id: "exit", name: "terminal", args: { op: "run", command: "false", timeoutMs: 2000 } },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("code 1");
    expect(result.data).toMatchObject({ exitCode: 1, timedOut: false });
  });

  test("terminal tool deadline covers the requested command wait", () => {
    const terminal = builtinTools().find((tool) => tool.name === "terminal");
    expect(terminal?.timeoutMs?.({ op: "run", command: "build", timeoutMs: 300_000 })).toBe(
      310_000,
    );
  });

  test("file mutation tools reject a FIFO before reading it", async () => {
    if (process.platform === "win32") return;
    const ctx = await context();
    const made = Bun.spawnSync(["mkfifo", join(ctx.cwd, "pipe")]);
    if (made.exitCode !== 0) return;
    const tools = registry();
    for (const call of [
      { id: "write", name: "write", args: { path: "pipe", content: "clobber" } },
      { id: "edit", name: "edit", args: { path: "pipe", oldString: "a", newString: "b" } },
    ]) {
      const result = await tools.run(call, ctx);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not a regular file");
    }
  });

  test("task cancellation reaches the child even when its factory omits a signal", async () => {
    const ctx: TaskToolContext = await context();
    const controller = new AbortController();
    ctx.signal = controller.signal;
    const spec: SubagentSpec = {
      id: "worker",
      name: "Worker",
      description: "Test worker",
      systemPrompt: "Return a summary",
      allowedTools: [],
      permissions: [],
      budget: { maxTurns: 2, maxTokens: 1000 },
      resultSchema: z.object({ summary: z.string() }),
    };
    let sawAbort = false;
    ctx.subagentRunnerFactory = () => ({
      runner: new SubagentRunner(new SubagentRegistry([spec])),
      runChild: async (request) => {
        controller.abort();
        sawAbort = request.signal.aborted;
        return { text: '{"summary":"cancelled"}', usage: emptyUsage() };
      },
    });
    const result = await registry().run(
      { id: "task", name: "task", args: { agent: "worker", prompt: "work" } },
      ctx,
    );
    expect(sawAbort).toBe(true);
    expect(result.ok).toBe(false);
  });
});
