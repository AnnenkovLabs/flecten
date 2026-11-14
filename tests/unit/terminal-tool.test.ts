import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalManager } from "../../src/terminal/manager";
import { runBash } from "../../src/tools/bash/run";
import { runTerminal } from "../../src/tools/terminal/run";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { processAlive } from "../helpers/process-alive";
import { bunCommand, childSource } from "../helpers/terminal-fixtures";

const managers: TerminalManager[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.closeAll();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function waitForDead(pid: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await Bun.sleep(20);
  }
  throw new Error(`Process ${pid} is still alive`);
}

async function readPid(file: string, timeoutMs = 2000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pid = Number(readFileSync(file, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {}
    await Bun.sleep(20);
  }
  throw new Error(`No pid written to ${file}`);
}

function context(cwd: string, manager: TerminalManager): ToolContext {
  return {
    sessionId: "s-terminal",
    cwd,
    signal: new AbortController().signal,
    logDir: join(cwd, ".liquid", "logs"),
    limits: {
      maxOutputBytes: 50_000,
      maxOutputLines: 2000,
      bashTimeoutMs: 10_000,
      readLimitLines: 2000,
    },
    reads: new ReadTracker(),
    terminals: manager,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd, LANG: "C.UTF-8" },
  };
}

describe.skipIf(process.platform === "win32")("terminal tool", () => {
  test("a persistent terminal cannot accept another command under a changed boundary", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-terminal-boundary-"));
    dirs.push(cwd);
    const manager = new TerminalManager();
    managers.push(manager);
    const ctx = context(cwd, manager);
    expect((await runTerminal({ op: "run", command: "printf first" }, ctx)).ok).toBe(true);
    ctx.osSandbox = { enabled: true, workspaceRoot: cwd, allowNetwork: false, envAllowlist: [] };
    const blocked = await runTerminal({ op: "run", command: "printf must-not-execute" }, ctx);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("Execution boundary changed");
    expect((await runTerminal({ op: "kill" }, ctx)).ok).toBe(true);
    expect(manager.list()).toHaveLength(0);
  });
  test("runs commands in a persistent shell with exit code", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-terminal-tool-"));
    dirs.push(cwd);
    const manager = new TerminalManager();
    managers.push(manager);
    const ctx = context(cwd, manager);

    const first = await runTerminal({ op: "run", command: "printf hello" }, ctx);
    expect(first.ok).toBe(true);
    expect(first.output).toContain("hello");
    expect((first.data as { exitCode: number }).exitCode).toBe(0);

    const second = await runTerminal({ op: "run", command: "pwd" }, ctx);
    expect(second.ok).toBe(true);
    expect(second.output).toContain(cwd);

    const listed = await runTerminal({ op: "list" }, ctx);
    expect(listed.output).toContain("default");
  }, 20_000);

  test("returns new command output when scrollback discards older lines", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-terminal-scrollback-"));
    dirs.push(cwd);
    const manager = new TerminalManager({ shell: "/bin/sh", scrollback: 6 });
    managers.push(manager);
    const ctx = context(cwd, manager);
    const fill = await runTerminal(
      {
        op: "run",
        command:
          'i=0; while [ "$i" -lt 20 ]; do printf \'old-%04d-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n\' "$i"; i=$((i+1)); done',
      },
      ctx,
    );
    expect(fill.ok).toBe(true);
    expect(manager.get("default")?.snapshot().truncated).toBe(true);
    const result = await runTerminal(
      { op: "run", command: "printf 'new-result\\nnew-next\\nnew-tail\\n'" },
      ctx,
    );
    expect(result).toMatchObject({ ok: true, data: { exitCode: 0 } });
    expect(result.output).toContain("new-tail");
    const output = (result.data as { output: string }).output;
    expect(output).toContain("new-tail");
    expect(output).not.toContain("old-");
  });

  test("can write to an interactive process and kill it", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-terminal-interactive-"));
    dirs.push(cwd);
    const manager = new TerminalManager();
    managers.push(manager);
    const ctx = context(cwd, manager);

    const started = await runTerminal({ op: "run", command: "cat", timeoutMs: 300 }, ctx);
    expect(started.ok).toBe(true);
    expect((started.data as { timedOut: boolean }).timedOut).toBe(true);

    const written = await runTerminal({ op: "write", input: "hello\n" }, ctx);
    expect(written.output).toContain("hello");

    const killed = await runTerminal({ op: "kill" }, ctx);
    expect(killed.ok).toBe(true);
  }, 20_000);

  test("an existing terminal keeps its shell protocol after settings change", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-terminal-shell-change-"));
    dirs.push(cwd);
    const manager = new TerminalManager({ shell: "/bin/sh" });
    managers.push(manager);
    const ctx = context(cwd, manager);
    const first = await runTerminal({ op: "run", command: "printf first", timeoutMs: 1000 }, ctx);
    expect(first).toMatchObject({ ok: true, data: { exitCode: 0, timedOut: false } });
    manager.configure({ shell: "cmd.exe" });
    const next = await runTerminal({ op: "run", command: "false", timeoutMs: 1000 }, ctx);
    expect(next).toMatchObject({ ok: false, data: { exitCode: 1, timedOut: false } });
    expect(manager.get("default")?.shellPath).toBe("/bin/sh");
  });

  test("a completed shell is replaced on the next run", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-terminal-reopen-"));
    dirs.push(cwd);
    const manager = new TerminalManager();
    managers.push(manager);
    const ctx = context(cwd, manager);
    const closed = await runTerminal({ op: "run", command: "exit 4", timeoutMs: 1000 }, ctx);
    expect(closed).toMatchObject({ ok: false, data: { exitCode: 4, running: false } });
    const next = await runTerminal({ op: "run", command: "printf reopened", timeoutMs: 1000 }, ctx);
    expect(next).toMatchObject({ ok: true, data: { exitCode: 0, timedOut: false } });
    expect(next.output).toContain("reopened");
  });

  test("tool cancellation kills the interactive command's child tree", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-terminal-abort-"));
    dirs.push(cwd);
    const manager = new TerminalManager();
    managers.push(manager);
    const controller = new AbortController();
    const ctx = { ...context(cwd, manager), signal: controller.signal };
    const pidFile = join(cwd, "interactive.pid");
    const execution = runTerminal(
      { op: "run", command: await bunCommand(cwd, childSource({ pidFile })), timeoutMs: 5000 },
      ctx,
    );
    const child = await readPid(pidFile);
    expect(processAlive(child)).toBe(true);
    controller.abort();
    expect(await execution).toMatchObject({ ok: false, data: { aborted: true, running: false } });
    await waitForDead(child);
    expect(manager.list()).toEqual([]);
  });
});

test.skipIf(process.platform !== "win32")(
  "terminal tool runs persistent native Windows commands through ConPTY",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-terminal-windows-"));
    dirs.push(cwd);
    const manager = new TerminalManager();
    managers.push(manager);
    const result = await runTerminal({ op: "run", command: "echo hello" }, context(cwd, manager));
    expect(result).toMatchObject({ ok: true, data: { exitCode: 0 } });
    expect(result.output).toContain("hello");
    const configured = await runTerminal(
      { op: "run", command: "set LH_CONPTY=kept" },
      context(cwd, manager),
    );
    expect(configured.ok).toBe(true);
    const next = await runTerminal(
      { op: "run", command: "echo %LH_CONPTY%" },
      context(cwd, manager),
    );
    expect(next.ok).toBe(true);
    expect(next.output).toContain("kept");
    const failed = await runTerminal(
      { op: "run", command: "cmd /c exit 23" },
      context(cwd, manager),
    );
    expect(failed).toMatchObject({ ok: false, data: { exitCode: 23 } });
    expect(manager.list()).toHaveLength(1);
  },
);

describe("foreground commands with the native platform shell", () => {
  test("timeout kills children, not only the shell", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-bash-timeout-"));
    dirs.push(cwd);
    const manager = new TerminalManager();
    managers.push(manager);
    const ctx = context(cwd, manager);
    const pidFile = join(cwd, "timeout.pid");
    const execution = runBash(
      { command: await bunCommand(cwd, childSource({ pidFile })), timeoutMs: 1500 },
      ctx,
    );
    const child = await readPid(pidFile);
    expect(processAlive(child)).toBe(true);
    const result = await execution;
    expect(result.ok).toBe(false);
    expect((result.data as { timedOut: boolean }).timedOut).toBe(true);
    await waitForDead(child);
  });

  test("exiting leaves no orphan children", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-bash-orphan-"));
    dirs.push(cwd);
    const manager = new TerminalManager();
    managers.push(manager);
    const ctx = context(cwd, manager);
    const pidFile = join(cwd, "orphan.pid");

    const result = await runBash(
      { command: await bunCommand(cwd, childSource({ pidFile, exit: true })) },
      ctx,
    );
    expect(result.ok).toBe(true);
    const child = await readPid(pidFile);
    await waitForDead(child);
  });
});
