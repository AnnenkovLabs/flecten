import type { ToolResult } from "../../core/types";
import { commandCompletion, commandWithCompletion } from "../../terminal/command-completion";
import { formatCommandReport } from "../../terminal/report";
import type { TerminalSession } from "../../terminal/session";
import type { TerminalSnapshot } from "../../terminal/types";
import { withShellCheckpoint } from "../shell-checkpoint";
import type { ToolContext } from "../types";
import { resolveToolPath } from "../util/paths";
import type { TerminalArgs } from "./schema";
import { streamTerminal } from "./stream";

const sessionBoundaries = new WeakMap<TerminalSession, string>();

function snapshotData(snapshot: TerminalSnapshot): Record<string, unknown> {
  return {
    kind: "terminal",
    id: snapshot.id,
    cwd: snapshot.cwd,
    running: snapshot.running,
    exitCode: snapshot.exitCode,
    signal: snapshot.signal,
    timedOut: snapshot.timedOut,
    truncated: snapshot.truncated,
    droppedLines: snapshot.droppedLines,
  };
}

function cleanOutput(snapshot: TerminalSnapshot, marker: string): string {
  let text = Bun.stripANSI(snapshot.plainText).replaceAll("\r\n", "\n").replaceAll("\r", "");
  const frame = commandCompletion(text, marker);
  if (frame) text = text.slice(0, frame.start) + text.slice(frame.end);
  return text.trimEnd();
}

function waitForMarker(
  session: TerminalSession,
  marker: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  if (!session.snapshot().running) return Promise.resolve();
  if (commandCompletion(session.snapshot().plainText, marker)) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const unsubscribe = session.onEvent((event) => {
      if (event.type === "data" && commandCompletion(session.snapshot().plainText, marker))
        finish();
      else if (event.type === "exit" || event.type === "error") finish();
    });
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function runTerminal(args: TerminalArgs, context: ToolContext): Promise<ToolResult> {
  if (context.signal.aborted) {
    return { ok: false, output: "", error: "Terminal operation aborted" };
  }
  if (args.op === "run" && !args.command?.trim()) {
    return { ok: false, output: "", error: "run needs command" };
  }
  const manager = context.terminals;
  if (!manager) {
    return { ok: false, output: "", error: "Persistent terminal is not available in this session" };
  }

  if (args.op === "list") {
    return {
      ok: true,
      output: manager
        .list()
        .map((session) => {
          const snapshot = session.snapshot();
          return `${snapshot.id}: ${snapshot.running ? "running" : "exited"} ${snapshot.cwd}`;
        })
        .join("\n"),
      data: {
        kind: "terminal",
        terminals: manager.list().map((session) => snapshotData(session.snapshot())),
      },
    };
  }

  const id = args.id ?? "default";
  if (args.op === "kill") {
    const existed = manager.get(id) !== undefined;
    await manager.close(id);
    return {
      ok: true,
      output: existed ? `Terminal ${id} closed.` : `Terminal ${id} was not running.`,
      data: { kind: "terminal", id, closed: existed },
    };
  }

  let session = manager.get(id);
  const boundary = JSON.stringify(context.osSandbox ?? null);
  if (
    session &&
    (args.op === "run" || args.op === "write") &&
    sessionBoundaries.has(session) &&
    sessionBoundaries.get(session) !== boundary
  )
    return {
      ok: false,
      output: "",
      error:
        "Execution boundary changed. Close this terminal and start a new one before sending another command.",
    };
  if (session && args.op === "run" && !session.snapshot().running) {
    await manager.close(id);
    session = undefined;
  }
  if (session && (args.op === "write" || args.op === "resize") && !session.snapshot().running)
    return { ok: false, output: "", error: `Terminal ${id} is not running` };
  if (!session) {
    if (args.op === "read" || args.op === "resize" || args.op === "write") {
      return { ok: false, output: "", error: `Terminal ${id} is not running` };
    }
    const cwd = resolveToolPath(context.cwd, args.cwd ?? ".");
    try {
      session = manager.create(id, {
        cwd,
        ...(context.env ? { env: context.env } : {}),
        ...(context.osSandbox ? { sandbox: context.osSandbox } : {}),
        ...(args.cols ? { cols: args.cols } : {}),
        ...(args.rows ? { rows: args.rows } : {}),
      });
      sessionBoundaries.set(session, boundary);
    } catch (error) {
      return {
        ok: false,
        output: "",
        error: `Cannot start terminal: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (args.op === "read") {
    const snapshot = session.snapshot();
    return {
      ok: true,
      output: snapshot.plainText || "(no output)",
      data: snapshotData(snapshot),
    };
  }

  if (args.op === "resize") {
    if (!args.cols && !args.rows) {
      return { ok: false, output: "", error: "resize needs cols or rows" };
    }
    const current = session.snapshot();
    session.resize(args.cols ?? current.cols, args.rows ?? current.rows);
    const snapshot = session.snapshot();
    return {
      ok: true,
      output: `Terminal ${id} resized to ${snapshot.cols}x${snapshot.rows}.`,
      data: snapshotData(snapshot),
    };
  }

  if (args.op === "write") {
    if (args.input === undefined) {
      return { ok: false, output: "", error: "write needs input" };
    }
    session.write(args.input);
    await Bun.sleep(80);
    const snapshot = session.snapshot();
    return {
      ok: true,
      output: snapshot.plainText.slice(-20_000) || "(no output)",
      data: snapshotData(snapshot),
    };
  }

  if (args.command === undefined || args.command.trim().length === 0) {
    return { ok: false, output: "", error: "run needs command" };
  }

  const before = session.snapshot();
  const startedAt = Date.now();
  const marker = `__FLECTEN_DONE_${crypto.randomUUID().replaceAll("-", "")}__`;
  const timeoutMs = Math.min(args.timeoutMs ?? manager.commandTimeoutMs, 600_000);
  const started = performance.now();
  const finishStream = streamTerminal(session, context);
  try {
    session.write(commandWithCompletion(args.command, session.shellPath, marker));
    await waitForMarker(session, marker, timeoutMs, context.signal);
  } finally {
    finishStream();
  }
  const aborted = context.signal.aborted;
  if (aborted) await manager.close(id);
  const durationMs = Math.round(performance.now() - started);
  const snapshot = session.snapshot();
  const text = cleanOutput(snapshot, marker);
  const markerCode = commandCompletion(snapshot.plainText, marker)?.exitCode ?? null;
  const exitCode = markerCode ?? (snapshot.running ? null : snapshot.exitCode);
  const timedOut = !aborted && markerCode === null && snapshot.running;
  const lost = !snapshot.running && markerCode === null && exitCode === null;
  const report = formatCommandReport({
    command: args.command,
    cwd: before.cwd,
    startedAt,
    durationMs,
    exitCode,
    signal: snapshot.signal,
    stdout: text.slice(before.plainText.length),
    stderr: "",
    truncated: snapshot.truncated,
    timedOut,
  });

  return {
    ok: !aborted && !lost && (exitCode === null || exitCode === 0),
    output: report,
    ...(aborted
      ? { error: `Terminal ${id} aborted; process tree stopped` }
      : lost
        ? { error: `Terminal ${id} exited before reporting command completion` }
        : exitCode !== null && exitCode !== 0
          ? { error: `Command exited with code ${exitCode}` }
          : {}),
    data: {
      ...snapshotData(snapshot),
      exitCode,
      durationMs,
      timedOut,
      aborted,
      command: args.command,
      output: text.slice(before.plainText.length).slice(0, 50_000),
    },
  };
}

/** `run` and `write` change the workspace like bash does, so they run between two snapshots. */
export function runTerminalTool(args: TerminalArgs, context: ToolContext): Promise<ToolResult> {
  const text = args.op === "run" ? args.command : args.op === "write" ? args.input : undefined;
  if (text === undefined || text.trim().length === 0) return runTerminal(args, context);
  const cwd = context.terminals?.get(args.id ?? "default")?.snapshot().cwd ?? context.cwd;
  return withShellCheckpoint(context, { tool: "terminal", command: text, cwd }, () =>
    runTerminal(args, context),
  );
}
