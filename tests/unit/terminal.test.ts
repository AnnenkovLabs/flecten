import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalManager } from "../../src/terminal/manager";
import { formatCommandReport } from "../../src/terminal/report";
import { TerminalSession } from "../../src/terminal/session";
import type { TerminalEvent, TerminalStartOptions } from "../../src/terminal/types";
import { processAlive } from "../helpers/process-alive";

type ExitEvent = Extract<TerminalEvent, { type: "exit" }>;

const sessions: TerminalSession[] = [];
const dirs: string[] = [];
const envOriginals = new Map<string, string | undefined>();

function track(session: TerminalSession): TerminalSession {
  sessions.push(session);
  return session;
}

function startSession(options: TerminalStartOptions): TerminalSession {
  const session = track(new TerminalSession());
  session.start({ shell: Bun.which("bash") ?? "/bin/bash", ...options });
  return session;
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-terminal-"));
  dirs.push(dir);
  return dir;
}

function setTestEnv(key: string, value: string): void {
  if (!envOriginals.has(key)) envOriginals.set(key, process.env[key]);
  process.env[key] = value;
}

function waitFor(session: TerminalSession, text: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};

    const succeed = () => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const fail = (message: string) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      reject(new Error(message));
    };
    const check = () => {
      if (session.snapshot().plainText.includes(text)) succeed();
    };

    timer = setTimeout(() => fail(`Timed out waiting for ${text}`), timeoutMs);
    unsubscribe = session.onEvent((event) => {
      if (event.type === "data") check();
      else if (event.type === "error") fail(event.message);
      else if (event.type === "exit") {
        check();
        if (!done) fail(`Session exited before ${text}`);
      }
    });
    check();
  });
}

function currentExit(session: TerminalSession): ExitEvent {
  const snapshot = session.snapshot();
  return {
    type: "exit",
    exitCode: snapshot.exitCode,
    signal: snapshot.signal,
    timedOut: snapshot.timedOut,
  };
}

function waitForExit(session: TerminalSession, timeoutMs = 3000): Promise<ExitEvent> {
  const initial = session.snapshot();
  if (initial.startedAt > 0 && !initial.running) {
    if (initial.error !== null) return Promise.reject(new Error(initial.error));
    return Promise.resolve(currentExit(session));
  }

  return new Promise((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};

    const succeed = (event: ExitEvent) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      resolve(event);
    };
    const fail = (message: string) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      reject(new Error(message));
    };

    unsubscribe = session.onEvent((event) => {
      if (event.type === "exit") succeed(event);
      else if (event.type === "error") fail(event.message);
    });

    const current = session.snapshot();
    if (current.startedAt > 0 && !current.running) {
      if (current.error !== null) fail(current.error);
      else succeed(currentExit(session));
    }
    timer = setTimeout(() => fail("Timed out waiting for terminal exit"), timeoutMs);
  });
}

async function waitForDead(pid: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await Bun.sleep(20);
  }
  throw new Error(`Process ${pid} is still alive`);
}

async function waitForError(
  session: TerminalSession,
  text: string,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const error = session.snapshot().error;
    if (error?.includes(text)) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for error ${text}`);
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  for (const [key, value] of envOriginals) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  envOriginals.clear();
});

// These fixtures exercise POSIX shell syntax; native ConPTY has a Windows fixture.
describe.skipIf(process.platform === "win32")("TerminalSession POSIX PTY", () => {
  test("persists cwd, exported environment and aliases", async () => {
    const session = startSession({ cwd: await tempDir() });
    session.write("cd /usr && export LH_TERMINAL_KEPT=kept && alias lh='echo ALIAS_OK'\n");
    await Bun.sleep(50);
    session.write("pwd; echo KEPT=$LH_TERMINAL_KEPT; lh; printf 'DONE_%s\\n' PERSIST\n");
    await waitFor(session, "DONE_PERSIST");

    const text = session.snapshot().plainText;
    expect(text).toContain("\n/usr\n");
    expect(text).toContain("KEPT=kept");
    const aliasOutputs = text.split("ALIAS_OK").length - 1;
    expect(aliasOutputs).toBeGreaterThanOrEqual(2);
  });

  test("delivers interactive stdin", async () => {
    const session = startSession({ cwd: await tempDir() });
    session.write('read -r answer; printf "GOT:%s\\n" "$answer"; printf "DONE_%s\\n" STDIN\n');
    await Bun.sleep(50);
    session.write("hello terminal\n");
    await waitFor(session, "DONE_STDIN");

    expect(session.snapshot().plainText).toContain("GOT:hello terminal");
  });

  test("resizes the pty", async () => {
    const session = startSession({ cwd: await tempDir(), cols: 80, rows: 24 });
    await Bun.sleep(50);
    session.resize(120, 40);
    session.write("stty size; printf 'DONE_%s\\n' RESIZE\n");
    await waitFor(session, "DONE_RESIZE");

    const snapshot = session.snapshot();
    expect(snapshot.cols).toBe(120);
    expect(snapshot.rows).toBe(40);
    expect(snapshot.plainText).toContain("40 120");
  });

  test("kills the shell and its children", async () => {
    const session = startSession({ cwd: await tempDir() });
    session.write("sleep 30 & printf 'TREE_%s:%s\\n' READY $!\n");
    await waitFor(session, "TREE_READY:");

    const match = /TREE_READY:(\d+)/.exec(session.snapshot().plainText);
    expect(match).not.toBeNull();
    const child = Number(match?.[1]);
    expect(processAlive(child)).toBe(true);

    session.kill("SIGKILL");
    await waitForExit(session);
    await waitForDead(child);
    expect(processAlive(child)).toBe(false);
  });

  test("times out and stops the session", async () => {
    const session = startSession({ cwd: await tempDir(), timeoutMs: 100 });
    const exited = waitForExit(session);
    session.write("sleep 30\n");

    const event = await exited;
    expect(event.timedOut).toBe(true);
    expect(session.snapshot().running).toBe(false);
    expect(session.snapshot().timedOut).toBe(true);
  });

  test("isolates the environment and passes explicit values", async () => {
    setTestEnv("OPENAI_API_KEY", "sk-test-secret");
    setTestEnv("LH_TERMINAL_INHERITED", "inherited");
    const session = startSession({
      cwd: await tempDir(),
      env: { LH_TERMINAL_EXPLICIT: "ok" },
    });
    session.write(
      'printf "KEY:%s\\n" "$(printenv OPENAI_API_KEY || echo missing)"\n' +
        'printf "INHERITED:%s\\n" "$(printenv LH_TERMINAL_INHERITED || echo missing)"\n' +
        'printf "EXPLICIT:%s\\n" "$LH_TERMINAL_EXPLICIT"\n' +
        "printf 'DONE_%s\\n' ENV\n",
    );
    await waitFor(session, "DONE_ENV");

    const text = session.snapshot().plainText;
    expect(text).toContain("KEY:missing");
    expect(text).toContain("INHERITED:missing");
    expect(text).toContain("EXPLICIT:ok");
    expect(text).not.toContain("sk-test-secret");
  });

  test("caps output with an explicit truncation marker", async () => {
    const session = startSession({ cwd: await tempDir(), scrollback: 4 });
    session.write("printf 'ONE\\nTWO\\nTHREE\\nFOUR\\nFIVE\\n'; printf 'TRUNC_%s\\n' END\n");
    await waitFor(session, "TRUNC_END");

    const snapshot = session.snapshot();
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.droppedLines).toBeGreaterThan(0);
    expect(snapshot.truncationMarker).not.toBeNull();
    expect(snapshot.output).toContain("output truncated");
    expect(snapshot.plainText).toContain("TRUNC_END");

    const report = formatCommandReport({
      command: "printf lines",
      cwd: session.snapshot().cwd,
      startedAt: session.snapshot().startedAt,
      durationMs: 10,
      exitCode: 0,
      signal: null,
      stdout: snapshot.plainText,
      stderr: "",
      truncated: snapshot.truncated,
      timedOut: false,
    });
    expect(report).toContain("[... output truncated ...]");
  });

  test("reports a missing shell as an error event", async () => {
    const session = track(new TerminalSession());
    const errorEvent = new Promise<TerminalEvent>((resolve) => {
      const unsubscribe = session.onEvent((event) => {
        if (event.type !== "error") return;
        unsubscribe();
        resolve(event);
      });
    });

    session.start({ cwd: await tempDir(), shell: "liquid-missing-shell" });
    const event = await errorEvent;
    expect(event.type).toBe("error");
    if (event.type === "error") expect(event.message).toContain("Shell not found");
    expect(session.snapshot().running).toBe(false);
  });
});

test("a missing shell returns its startup failure to the caller", async () => {
  const session = track(new TerminalSession());
  const events: TerminalEvent[] = [];
  session.onEvent((event) => events.push(event));
  const error = session.start({ cwd: await tempDir(), shell: "liquid-missing-shell" });
  expect(error).toBeInstanceOf(Error);
  if (!error) throw new Error("Expected shell startup failure");
  expect(error.message).toContain("Shell not found");
  expect(session.snapshot()).toMatchObject({ running: false, error: error.message });
  expect(events).toContainEqual({ type: "error", message: error.message });
});

describe.skipIf(process.platform === "win32")("TerminalManager", () => {
  test("applies terminal settings to created sessions", async () => {
    setTestEnv("LH_TERMINAL_SECRET", "secret");
    const manager = new TerminalManager({
      scrollback: 5,
      ansi: false,
      envAllowlist: ["PATH", "HOME", "LANG"],
    });
    try {
      const session = manager.create("settings", { cwd: await tempDir() });
      session.write(
        "printf '\\033[31mRED\\033[0m\\n'\n" +
          "printf 'ONE\\nTWO\\nTHREE\\nFOUR\\nFIVE\\n'\n" +
          "printf 'SECRET:%s\\n' \"$(printenv LH_TERMINAL_SECRET || echo missing)\"\n" +
          "printf 'DONE_%s\\n' SETTINGS\n",
      );
      await waitFor(session, "DONE_SETTINGS");

      const snapshot = session.snapshot();
      expect(snapshot.scrollback).toBe(5);
      expect(snapshot.output).not.toContain("\u001b[");
      expect(snapshot.plainText).not.toContain("\u001b[");
      expect(snapshot.plainText).toContain("SECRET:missing");
      expect(snapshot.truncated).toBe(true);
      expect(snapshot.plainText).toContain("DONE_SETTINGS");
    } finally {
      await manager.closeAll();
    }
  });

  test("enforces resource limits on a session", async () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const port = probe.port;
    probe.stop(true);
    expect(port).toBeGreaterThan(2000);
    const manager = new TerminalManager({
      limits: {
        maxProcesses: 128,
        maxMemoryBytes: 1024 * 1024 * 1024,
        ports: { min: 1024, max: 2000 },
      },
    });
    try {
      const session = manager.create("limited", { cwd: await tempDir() });
      session.write(
        `bun -e 'Bun.serve({ port: ${port}, fetch() { return new Response("ok"); } }); setInterval(() => {}, 1000);'\n`,
      );
      await waitForError(session, `port ${port}`);
      const deadline = Date.now() + 4000;
      while (session.snapshot().running && Date.now() < deadline) await Bun.sleep(50);
      expect(session.snapshot().running).toBe(false);
    } finally {
      await manager.closeAll();
    }
  }, 15_000);

  test("creates, lists and closes sessions", async () => {
    const dir = await tempDir();
    const manager = new TerminalManager();
    try {
      const one = manager.create("one", { cwd: dir });
      const two = manager.create("two", { cwd: dir });

      expect(manager.get("one")).toBe(one);
      expect(
        manager
          .list()
          .map((session) => session.id)
          .sort(),
      ).toEqual(["one", "two"]);

      await manager.close("one");
      expect(manager.get("one")).toBeUndefined();
      expect(manager.list().map((session) => session.id)).toEqual(["two"]);

      await manager.closeAll();
      expect(manager.list()).toEqual([]);
      expect(two.snapshot().running).toBe(false);
    } finally {
      await manager.closeAll();
    }
  });
});

describe("formatCommandReport", () => {
  test("renders every field and empty streams", () => {
    const report = formatCommandReport({
      command: "bun test",
      cwd: "/home/user/repo",
      startedAt: Date.UTC(2026, 9, 25, 15, 19, 26),
      durationMs: 123,
      exitCode: 0,
      signal: null,
      stdout: "ok\n",
      stderr: "",
      truncated: false,
      timedOut: false,
    });

    expect(report).toContain("bun test");
    expect(report).toContain("cwd: /home/user/repo");
    expect(report).toContain("startedAt: 2026-10-25T15:19:26.000Z");
    expect(report).toContain("durationMs: 123");
    expect(report).toContain("exitCode: 0");
    expect(report).toContain("signal: none");
    expect(report).toContain("timedOut: false");
    expect(report).toContain("truncated: false");
    expect(report).toContain("stdout:");
    expect(report).toContain("ok");
    expect(report).toContain("(empty)");
    expect(report).not.toContain("output truncated");
  });

  test("strips ANSI and marks truncation, timeout and signals", () => {
    const report = formatCommandReport({
      command: "sleep 30",
      cwd: "/repo",
      startedAt: Date.UTC(2026, 0, 1),
      durationMs: 5000,
      exitCode: null,
      signal: "SIGKILL",
      stdout: "\u001b[31mred\u001b[0m\n",
      stderr: "warn\n",
      truncated: true,
      timedOut: true,
    });

    expect(report).toContain("red");
    expect(report).not.toContain("\u001b[");
    expect(report).toContain("exitCode: none");
    expect(report).toContain("signal: SIGKILL");
    expect(report).toContain("timedOut: true");
    expect(report).toContain("truncated: true");
    expect(report).toContain("warn");
    expect(report).toContain("[... output truncated ...]");
  });
});
