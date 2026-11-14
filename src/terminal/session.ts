import {
  buildBubblewrapArgs,
  buildSeatbeltProfile,
  detectSandbox,
  type SandboxDetection,
} from "../security/os-sandbox";
import { createProcessScope } from "./process-scope";
import { killProcessTree } from "./process-tree";
import { ResourceMonitor, withResourceLimits } from "./resources";
import { defaultTerminalShell, type TerminalResourceLimits } from "./settings";
import { buildEnvironment, resolveShell, shellArgs } from "./shell";
import type {
  TerminalEvent,
  TerminalEventListener,
  TerminalSnapshot,
  TerminalStartOptions,
} from "./types";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_SCROLLBACK = 1000;
const MAX_BUFFER_CHARS = 2 * 1024 * 1024;
const TERM_GRACE_MS = 200;
const DISPOSE_GRACE_MS = 200;
const RESOURCE_MONITOR_MS = 250;
export type TerminalSandboxPolicy = {
  enabled: boolean;
  allowNetwork: boolean;
  workspaceRoot: string;
  envAllowlist: string[];
  writablePaths?: string[];
  readOnlyPaths?: string[];
  readDeniedPaths?: string[];
};

export type ShellSandbox =
  | { supported: true; command: string[] }
  | { supported: false; reason: string };

export class SandboxUnsupportedError extends Error {
  readonly code = "sandbox_unsupported";

  constructor(readonly reason: string) {
    super(`OS sandbox unavailable: ${reason}`);
    this.name = "SandboxUnsupportedError";
  }
}

export class TerminalStartError extends Error {
  readonly code = "terminal_start_failed";

  constructor(message: string) {
    super(message);
    this.name = "TerminalStartError";
  }
}

export function wrapShellCommand(
  command: string,
  args: readonly string[],
  policy: TerminalSandboxPolicy & { cwd: string },
  detection: SandboxDetection = detectSandbox(),
): ShellSandbox {
  if (detection.kind === "none") return { supported: false, reason: detection.reason };
  if (detection.kind === "bubblewrap") {
    return {
      supported: true,
      command: [
        detection.command ?? "bwrap",
        ...buildBubblewrapArgs({ ...policy, command, args: [...args] }),
      ],
    };
  }
  return {
    supported: true,
    command: [
      detection.command ?? "/usr/bin/sandbox-exec",
      "-p",
      buildSeatbeltProfile(policy),
      command,
      ...args,
    ],
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function countNewlines(text: string): number {
  return text.split("\n").length - 1;
}

function toPlain(text: string): string {
  return Bun.stripANSI(text).replaceAll("\r\n", "\n").replaceAll("\r", "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TerminalSession {
  readonly id: string;

  private started = false;
  private disposed = false;
  private finished = false;
  private running = false;
  private isolated = false;
  private proc: Bun.Subprocess | null = null;
  private pty: Bun.Terminal | null = null;
  private decoder = new TextDecoder();
  private buffer = "";
  private outputOffset = 0;
  private lineBreaks = 0;
  private droppedLines = 0;
  private truncated = false;
  private cols = DEFAULT_COLS;
  private rows = DEFAULT_ROWS;
  private scrollback = DEFAULT_SCROLLBACK;
  private ansi = true;
  private cwd = "";
  private resolvedShell = "";
  private startedAt = 0;
  private exitCode: number | null = null;
  private signal: string | null = null;
  private timedOut = false;
  private error: string | null = null;
  private limitError: string | null = null;
  private limits: TerminalResourceLimits | null = null;
  private resourceMonitor: ResourceMonitor | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private escalationTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<TerminalEventListener>();

  constructor(id = "") {
    this.id = id;
  }

  get shellPath(): string {
    return this.resolvedShell;
  }

  start(
    options: TerminalStartOptions & { sandbox?: TerminalSandboxPolicy },
    detection: SandboxDetection = detectSandbox(),
  ): SandboxUnsupportedError | TerminalStartError | null {
    if (this.started) throw new Error("Terminal session already started");
    if (typeof options.cwd !== "string" || options.cwd.length === 0) {
      throw new Error("Terminal cwd is required");
    }
    const cols = positiveInteger(options.cols ?? DEFAULT_COLS, "cols");
    const rows = positiveInteger(options.rows ?? DEFAULT_ROWS, "rows");
    const scrollback = positiveInteger(options.scrollback ?? DEFAULT_SCROLLBACK, "scrollback");
    const timeoutMs =
      options.timeoutMs === undefined ? null : positiveInteger(options.timeoutMs, "timeoutMs");

    this.started = true;
    this.startedAt = Date.now();
    this.cwd = options.cwd;
    this.cols = cols;
    this.rows = rows;
    this.scrollback = scrollback;
    this.ansi = options.ansi ?? true;
    this.limits = options.limits ?? null;

    const requestedShell = options.shell ?? defaultTerminalShell();
    const shell = resolveShell(requestedShell);
    if (shell === null) {
      this.error = `Shell not found: ${requestedShell}`;
      this.emit({ type: "error", message: this.error });
      return new TerminalStartError(this.error);
    }
    this.resolvedShell = shell;

    const env = buildEnvironment(this.cwd, shell, options.env, options.envAllowlist);
    const setsid = process.platform === "win32" ? null : Bun.which("setsid");
    const shellArguments = shellArgs(shell);
    const commandShell = setsid ?? shell;
    const commandArgs = setsid !== null ? [shell, ...shellArguments] : shellArguments;
    let command = [commandShell, ...commandArgs];
    const sandbox = options.sandbox;
    if (sandbox?.enabled) {
      const wrapped = wrapShellCommand(
        commandShell,
        commandArgs,
        { ...sandbox, cwd: this.cwd },
        detection,
      );
      if (!wrapped.supported) {
        const error = new SandboxUnsupportedError(wrapped.reason);
        this.error = error.message;
        this.emit({ type: "error", message: this.error });
        return error;
      }
      command = wrapped.command;
    }
    if (this.limits !== null) command = withResourceLimits(command, this.limits);

    const scope = createProcessScope();
    try {
      const pty = new Bun.Terminal({
        cols,
        rows,
        name: "xterm-256color",
        data: (_terminal, data) => this.receive(data),
      });
      this.pty = pty;
      const proc = Bun.spawn({
        cmd: command,
        cwd: this.cwd,
        env: { ...env, ...scope.environment },
        terminal: pty,
      });
      this.proc = proc;
      scope.attach(proc.pid);
      this.isolated = setsid !== null;
      this.running = true;
      void proc.exited
        .then((code) => this.finish(code))
        .catch((cause: unknown) => this.fail(cause));
      if (this.limits !== null) {
        this.resourceMonitor = new ResourceMonitor(
          () => ({ pid: this.proc?.pid ?? null, isolated: this.isolated }),
          this.limits,
          (message) => this.onResourceLimit(message),
        );
        this.resourceMonitor.start(RESOURCE_MONITOR_MS);
      }
      if (timeoutMs !== null) {
        this.timeoutTimer = setTimeout(() => this.onTimeout(), timeoutMs);
      }
    } catch (cause) {
      try {
        this.pty?.close();
      } catch {}
      this.pty = null;
      this.running = false;
      this.error = errorMessage(cause);
      this.emit({ type: "error", message: this.error });
      return new TerminalStartError(this.error);
    }
    return null;
  }
  write(data: string): void {
    if (!this.running || this.pty === null || this.pty.closed) return;
    this.pty.write(data);
  }
  resize(cols: number, rows: number): void {
    positiveInteger(cols, "cols");
    positiveInteger(rows, "rows");
    this.cols = cols;
    this.rows = rows;
    if (this.pty !== null && !this.pty.closed) this.pty.resize(cols, rows);
  }
  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (this.finished || this.proc === null) return;
    this.signalProcesses(signal);
    if (signal === "SIGTERM") this.scheduleEscalation();
  }
  onEvent(listener: TerminalEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  get outputCursor(): number {
    return this.outputOffset + this.buffer.length;
  }
  outputSince(cursor: number): string {
    return this.buffer.slice(Math.max(0, cursor - this.outputOffset));
  }
  snapshot(): TerminalSnapshot {
    const marker = this.truncationMarker();
    return {
      id: this.id,
      cwd: this.cwd,
      cols: this.cols,
      rows: this.rows,
      scrollback: this.scrollback,
      output: marker === null ? this.buffer : `${marker}\n${this.buffer}`,
      plainText: toPlain(this.buffer),
      truncated: this.truncated,
      droppedLines: this.droppedLines,
      truncationMarker: marker,
      running: this.running,
      startedAt: this.startedAt,
      exitCode: this.exitCode,
      signal: this.signal,
      timedOut: this.timedOut,
      error: this.error,
    };
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const proc = this.proc;
    if (proc !== null && !this.finished) {
      this.signalProcesses("SIGTERM");
      await Promise.race([proc.exited.catch(() => 0), Bun.sleep(DISPOSE_GRACE_MS)]);
      this.signalProcesses("SIGKILL");
      await Promise.race([proc.exited.catch(() => 0), Bun.sleep(DISPOSE_GRACE_MS * 2)]);
    }
    this.clearTimers();
    this.running = false;
    try {
      this.pty?.close();
    } catch {}
    this.pty = null;
    this.listeners.clear();
  }
  private receive(bytes: Uint8Array): void {
    if (this.finished) return;
    const decoded = this.decoder.decode(bytes, { stream: true });
    const data = this.ansi ? decoded : Bun.stripANSI(decoded);
    if (data.length === 0) return;
    this.append(data);
    this.emit({
      type: "data",
      data,
      plainText: toPlain(data),
      truncated: this.truncated,
    });
  }
  private append(chunk: string): void {
    this.buffer += chunk;
    this.lineBreaks += countNewlines(chunk);
    const totalLines = this.lineBreaks + (this.buffer.length > 0 ? 1 : 0);
    if (totalLines > this.scrollback) {
      const drop = totalLines - this.scrollback;
      let cut = 0;
      let remaining = drop;
      while (remaining > 0) {
        const next = this.buffer.indexOf("\n", cut);
        if (next < 0) {
          cut = this.buffer.length;
          break;
        }
        cut = next + 1;
        remaining -= 1;
      }
      const removed = this.buffer.slice(0, cut);
      this.outputOffset += removed.length;
      this.buffer = this.buffer.slice(cut);
      this.lineBreaks -= countNewlines(removed);
      this.droppedLines += drop;
      this.truncated = true;
    }
    if (this.buffer.length > MAX_BUFFER_CHARS) {
      const cut = this.buffer.length - MAX_BUFFER_CHARS;
      const removed = this.buffer.slice(0, cut);
      const removedLines = countNewlines(removed);
      this.outputOffset += removed.length;
      this.buffer = this.buffer.slice(cut);
      this.lineBreaks -= removedLines;
      this.droppedLines += Math.max(1, removedLines);
      this.truncated = true;
    }
  }
  private onTimeout(): void {
    if (this.finished) return;
    this.timeoutTimer = null;
    this.timedOut = true;
    this.signalProcesses("SIGTERM");
    this.scheduleEscalation();
  }
  private onResourceLimit(message: string): void {
    if (this.finished || this.limitError !== null) return;
    this.limitError = message;
    this.error = message;
    this.signalProcesses("SIGKILL");
  }
  private scheduleEscalation(): void {
    if (this.escalationTimer !== null) return;
    this.escalationTimer = setTimeout(() => {
      this.escalationTimer = null;
      if (!this.finished) this.signalProcesses("SIGKILL");
    }, TERM_GRACE_MS);
  }

  // ponytail: a daemon that calls setsid leaves this session; use a cgroup or job
  // object when containment must survive that.
  private signalProcesses(signal: NodeJS.Signals): void {
    const proc = this.proc;
    if (proc === null) return;
    killProcessTree(proc.pid, signal, this.isolated);
    try {
      proc.kill(signal);
    } catch {}
  }

  private finish(code: number | null): void {
    if (this.finished) return;
    const rest = this.decoder.decode();
    if (rest.length > 0) this.append(rest);
    this.finished = true;
    this.running = false;
    this.clearTimers();
    if (this.proc !== null) killProcessTree(this.proc.pid, "SIGKILL", this.isolated);
    const rawSignal = this.proc?.signalCode ?? null;
    this.signal = rawSignal === null ? null : String(rawSignal);
    this.exitCode = this.proc?.exitCode ?? code ?? null;
    if (this.limitError !== null) this.error = this.limitError;
    this.emit({
      type: "exit",
      exitCode: this.exitCode,
      signal: this.signal,
      timedOut: this.timedOut,
    });
  }

  private fail(cause: unknown): void {
    if (this.finished) return;
    this.finished = true;
    if (this.proc !== null) killProcessTree(this.proc.pid, "SIGKILL", this.isolated);
    this.running = false;
    this.clearTimers();
    this.error = errorMessage(cause);
    this.emit({ type: "error", message: this.error });
  }

  private truncationMarker(): string | null {
    if (!this.truncated) return null;
    if (this.droppedLines > 0) {
      return `[... terminal output truncated: ${this.droppedLines} earlier lines omitted ...]`;
    }
    return "[... terminal output truncated ...]";
  }

  private clearTimers(): void {
    this.resourceMonitor?.stop();
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.escalationTimer !== null) {
      clearTimeout(this.escalationTimer);
      this.escalationTimer = null;
    }
  }

  private emit(event: TerminalEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
