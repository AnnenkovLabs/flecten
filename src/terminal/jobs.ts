import { createProcessScope } from "./process-scope";
import { killProcessTree } from "./process-tree";
import { ResourceMonitor, withResourceLimits } from "./resources";
import { type TerminalSandboxPolicy, wrapShellCommand } from "./session";
import type { TerminalSettings } from "./settings";
import { buildEnvironment, resolveShell, shellCommandArgs } from "./shell";

export type TerminalJobStatus = "running" | "exited" | "failed" | "stopped";

export interface TerminalJobOptions {
  cwd: string;
  env?: Record<string, string>;
  persistent?: boolean;
  timeoutMs?: number | null;
  /** Same OS sandbox as foreground bash; the job fails to start when it is unavailable. */
  sandbox?: TerminalSandboxPolicy;
}

export interface TerminalJobSnapshot {
  id: string;
  command: string;
  cwd: string;
  status: TerminalJobStatus;
  pid: number | null;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  persistent: boolean;
  log: string;
  logBytes: number;
  droppedBytes: number;
  truncated: boolean;
  error: string | null;
}

export interface TerminalJobWait {
  job: TerminalJobSnapshot;
  timedOut: boolean;
}

export type TerminalJobListener = (snapshot: TerminalJobSnapshot) => void;

const MONITOR_INTERVAL_MS = 25;
const STOP_GRACE_MS = 200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TerminalJob {
  readonly id: string;
  readonly command: string;
  readonly cwd: string;
  readonly persistent: boolean;

  private readonly settings: TerminalSettings;
  private readonly env: Record<string, string> | undefined;
  private readonly sandbox: TerminalSandboxPolicy | undefined;
  private readonly timeoutMs: number | null;
  private readonly listeners = new Set<TerminalJobListener>();
  private readonly readers: Promise<void>[] = [];
  private readonly finishedPromise: Promise<void>;
  private readonly monitor: ResourceMonitor;
  private resolveFinished: () => void = () => {};
  private proc: Bun.Subprocess | null = null;
  private isolated = false;
  private status: TerminalJobStatus = "running";
  private startedAt = Date.now();
  private finishedAt: number | null = null;
  private exitCode: number | null = null;
  private signal: string | null = null;
  private timedOut = false;
  private error: string | null = null;
  private log = "";
  private logBytes = 0;
  private droppedBytes = 0;
  private truncated = false;
  private finished = false;
  private detached = false;
  private stopReason: "user" | "timeout" | "limit" | null = null;
  private limitError: string | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    id: string,
    command: string,
    options: TerminalJobOptions,
    settings: TerminalSettings,
  ) {
    this.id = id;
    this.command = command;
    this.cwd = options.cwd;
    this.settings = settings;
    this.env = options.env;
    this.sandbox = options.sandbox;
    this.persistent = options.persistent ?? settings.background.defaultPersistent;
    this.timeoutMs = options.timeoutMs === undefined ? settings.timeouts.jobMs : options.timeoutMs;
    this.finishedPromise = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
    this.monitor = new ResourceMonitor(
      () => ({ pid: this.proc?.pid ?? null, isolated: this.isolated }),
      settings.limits,
      (message) => this.enforceLimit(message),
    );
  }

  start(): void {
    const shell = resolveShell(this.settings.shell);
    if (shell === null) {
      this.failStart(`Shell not found: ${this.settings.shell}`);
      return;
    }
    const env = buildEnvironment(this.cwd, shell, this.env, this.settings.envAllowlist);
    const setsid = Bun.which("setsid");
    const command = this.command;
    const shellArgs = shellCommandArgs(shell, command);
    let cmd = setsid === null ? [shell, ...shellArgs] : [setsid, shell, ...shellArgs];
    if (this.sandbox?.enabled) {
      const [program = shell, ...args] = cmd;
      const wrapped = wrapShellCommand(program, args, { ...this.sandbox, cwd: this.cwd });
      if (!wrapped.supported) {
        this.failStart(`OS sandbox unavailable: ${wrapped.reason}`);
        return;
      }
      cmd = wrapped.command;
    }
    const scope = createProcessScope();
    try {
      const proc = Bun.spawn({
        cmd: withResourceLimits(cmd, this.settings.limits),
        cwd: this.cwd,
        env: { ...env, ...scope.environment },
        stdout: "pipe",
        stderr: "pipe",
      });
      this.proc = proc;
      scope.attach(proc.pid);
      this.isolated = setsid !== null;
      this.readers.push(this.read(proc.stdout), this.read(proc.stderr));
      void proc.exited
        .then((code) => this.finish(code))
        .catch((cause: unknown) => this.fail(cause));
      this.monitor.start(MONITOR_INTERVAL_MS);
      if (this.timeoutMs !== null) {
        this.timeoutTimer = setTimeout(() => this.onTimeout(), this.timeoutMs);
      }
    } catch (cause) {
      this.failStart(errorMessage(cause));
    }
  }

  snapshot(): TerminalJobSnapshot {
    return {
      id: this.id,
      command: this.command,
      cwd: this.cwd,
      status: this.status,
      pid: this.proc?.pid ?? null,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      exitCode: this.exitCode,
      signal: this.signal,
      timedOut: this.timedOut,
      persistent: this.persistent,
      log: this.log,
      logBytes: this.logBytes,
      droppedBytes: this.droppedBytes,
      truncated: this.truncated,
      error: this.error,
    };
  }

  async wait(timeoutMs = this.settings.timeouts.jobWaitMs): Promise<TerminalJobWait> {
    if (this.finished) return { job: this.snapshot(), timedOut: false };
    const completed = await Promise.race([
      this.finishedPromise.then(() => true),
      Bun.sleep(timeoutMs).then(() => false),
    ]);
    return { job: this.snapshot(), timedOut: !completed };
  }

  async stop(): Promise<TerminalJobSnapshot> {
    if (this.finished) return this.snapshot();
    this.stopReason = "user";
    this.kill("SIGTERM");
    await Promise.race([this.finishedPromise, Bun.sleep(STOP_GRACE_MS)]);
    if (!this.finished) {
      this.kill("SIGKILL");
      await Promise.race([this.finishedPromise, Bun.sleep(STOP_GRACE_MS * 2)]);
    }
    return this.snapshot();
  }

  onFinished(listener: TerminalJobListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  detach(): void {
    this.detached = true;
    this.clearTimers();
    this.listeners.clear();
  }

  private enforceLimit(message: string): void {
    if (this.finished) return;
    this.stopReason = "limit";
    this.limitError = message;
    this.kill("SIGKILL");
  }

  private onTimeout(): void {
    if (this.finished || this.timeoutMs === null) return;
    this.timeoutTimer = null;
    this.timedOut = true;
    this.stopReason = "timeout";
    this.kill("SIGKILL");
  }

  private kill(signal: NodeJS.Signals): void {
    if (this.proc === null) return;
    killProcessTree(this.proc.pid, signal, this.isolated);
  }

  private async read(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of stream) {
        this.append(decoder.decode(chunk, { stream: true }));
      }
      this.append(decoder.decode());
    } catch {
      // A killed job closes its pipes; the exit status carries the reason.
    }
  }

  private append(text: string): void {
    if (text.length === 0) return;
    const clean = this.settings.ansi ? text : Bun.stripANSI(text);
    this.log += clean;
    this.logBytes = Buffer.byteLength(this.log);
    const limit = this.settings.background.maxLogBytes;
    if (this.logBytes <= limit) return;
    const buffer = Buffer.from(this.log);
    let start = buffer.length - limit;
    const newline = buffer.indexOf(10, start);
    if (newline >= 0 && newline - start < 512) start = newline + 1;
    this.droppedBytes += start;
    this.truncated = true;
    this.log = buffer.subarray(start).toString("utf8");
    this.logBytes = Buffer.byteLength(this.log);
  }

  private async finish(code: number | null): Promise<void> {
    if (this.finished) return;
    if (this.proc !== null) killProcessTree(this.proc.pid, "SIGKILL", this.isolated);
    await Promise.all(this.readers);
    if (this.finished) return;
    this.finished = true;
    this.status = this.resolveStatus(code);
    this.finishedAt = Date.now();
    this.exitCode = this.proc?.exitCode ?? code ?? null;
    const rawSignal = this.proc?.signalCode ?? null;
    this.signal = rawSignal === null ? null : String(rawSignal);
    this.clearTimers();
    if (this.status === "failed" && this.error === null) {
      this.error =
        this.stopReason === "timeout"
          ? `Job timed out after ${this.timeoutMs}ms`
          : (this.limitError ?? `Command exited with code ${this.exitCode ?? "none"}`);
    }
    if (this.status === "stopped") this.error = null;
    this.resolveFinished();
    this.publish();
  }

  private resolveStatus(code: number | null): TerminalJobStatus {
    if (this.stopReason === "user") return "stopped";
    if (this.stopReason === "timeout" || this.stopReason === "limit") return "failed";
    return (this.proc?.exitCode ?? code) === 0 ? "exited" : "failed";
  }

  private failStart(message: string): void {
    if (this.finished) return;
    this.finished = true;
    this.status = "failed";
    this.finishedAt = Date.now();
    this.error = message;
    this.clearTimers();
    this.resolveFinished();
    this.publish();
  }

  private fail(cause: unknown): void {
    if (this.finished) return;
    if (this.proc !== null) killProcessTree(this.proc.pid, "SIGKILL", this.isolated);
    this.finished = true;
    this.status = "failed";
    this.finishedAt = Date.now();
    this.error = errorMessage(cause);
    this.clearTimers();
    this.resolveFinished();
    this.publish();
  }

  private publish(): void {
    if (this.detached) return;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  private clearTimers(): void {
    this.monitor.stop();
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
}
