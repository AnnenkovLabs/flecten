import type { TerminalResourceLimits } from "./settings";

export interface TerminalStartOptions {
  cwd: string;
  shell?: string;
  env?: Record<string, string>;
  envAllowlist?: string[];
  ansi?: boolean;
  limits?: TerminalResourceLimits;
  cols?: number;
  rows?: number;
  scrollback?: number;
  timeoutMs?: number;
}

export interface TerminalSnapshot {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  scrollback: number;
  output: string;
  plainText: string;
  truncated: boolean;
  droppedLines: number;
  truncationMarker: string | null;
  running: boolean;
  startedAt: number;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  error: string | null;
}

export type TerminalEvent =
  | {
      type: "data";
      data: string;
      plainText: string;
      truncated: boolean;
    }
  | {
      type: "exit";
      exitCode: number | null;
      signal: string | null;
      timedOut: boolean;
    }
  | {
      type: "error";
      message: string;
    };

export type TerminalEventListener = (event: TerminalEvent) => void;

export interface CommandReportInput {
  command: string;
  cwd: string;
  startedAt: number;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}
