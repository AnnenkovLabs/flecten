import type { TerminalJobSnapshot } from "../../terminal/jobs";

/** What the model and the UI see of a background job: no full log, only its size and tail. */
export interface JobView {
  id: string;
  command: string;
  cwd: string;
  status: TerminalJobSnapshot["status"];
  pid: number | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  logBytes: number;
  error: string | null;
}

export function jobView(job: TerminalJobSnapshot, now = Date.now()): JobView {
  return {
    id: job.id,
    command: job.command,
    cwd: job.cwd,
    status: job.status,
    pid: job.pid,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: (job.finishedAt ?? now) - job.startedAt,
    exitCode: job.exitCode,
    signal: job.signal,
    timedOut: job.timedOut,
    logBytes: job.logBytes,
    error: job.error,
  };
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export function jobLine(job: JobView): string {
  const exit = job.exitCode === null ? "" : `, exit ${job.exitCode}`;
  const signal = job.signal === null ? "" : `, signal ${job.signal}`;
  const timeout = job.timedOut ? ", timed out" : "";
  return `${job.id} ${job.status}${exit}${signal}${timeout}, ${seconds(job.durationMs)}: ${job.command}`;
}

/** Last `lines` lines of a log; long logs keep their end, where errors and results are. */
export function tail(log: string, lines: number): string {
  const trimmed = log.trimEnd();
  if (trimmed.length === 0) return "(no output yet)";
  const all = trimmed.split("\n");
  if (all.length <= lines) return trimmed;
  return [`[${all.length - lines} earlier lines omitted]`, ...all.slice(-lines)].join("\n");
}
