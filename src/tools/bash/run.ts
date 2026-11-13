import { stat } from "node:fs/promises";
import type { ToolResult } from "../../core/types";
import {
  detectSandbox,
  type RunSandboxOptions,
  type RunSandboxResult,
  runSandboxed,
  type SandboxDetection,
} from "../../security/os-sandbox";
import type { TerminalManager } from "../../terminal/manager";
import { ProcessOutputLog } from "../../terminal/output-log";
import { createProcessScope } from "../../terminal/process-scope";
import { killProcessTree } from "../../terminal/process-tree";
import { ResourceMonitor, withResourceLimits } from "../../terminal/resources";
import {
  DEFAULT_TERMINAL_SETTINGS,
  defaultTerminalShell,
  type TerminalResourceLimits,
} from "../../terminal/settings";
import { shellCommandArgs } from "../../terminal/shell";
import { seconds } from "../jobs/view";
import { withShellCheckpoint } from "../shell-checkpoint";
import type { OsSandboxContext, ToolContext } from "../types";
import { resolveToolPath } from "../util/paths";
import { startBackgroundBash } from "./background";
import type { BashArgs } from "./schema";

const MAX_COLLECT = 2 * 1024 * 1024;
const MAX_TIMEOUT_MS = 600_000;
const SANDBOX_TRUNCATION_MARKER = "\n[output truncated]";

type BashContext = {
  cwd: string;
  signal: AbortSignal;
  limits: { bashTimeoutMs: number };
  env?: Record<string, string>;
  osSandbox?: OsSandboxContext | undefined;
  terminals?: Pick<TerminalManager, "settings">;
  logDir?: string;
  reportOutput?(text: string): void;
  secrets?: readonly string[];
};

export type BashSandboxDeps = {
  detect: () => SandboxDetection;
  run: (options: RunSandboxOptions) => Promise<RunSandboxResult>;
};

type BashData = {
  kind: "terminal";
  command: string;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  sandboxed: boolean;
  durationMs: number;
  resourceError?: string;
};

const defaultSandboxDeps: BashSandboxDeps = {
  detect: detectSandbox,
  run: runSandboxed,
};

/** Appends chunks of both streams to one buffer in arrival order, up to MAX_COLLECT bytes. */
async function collect(
  stream: ReadableStream<Uint8Array>,
  state: { bytes: number; truncated: boolean; chunks: Uint8Array[] },
  log: ProcessOutputLog | undefined,
  channel: "stdout" | "stderr",
): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    await log?.write(decoder.decode(chunk, { stream: true }), channel);
    if (state.bytes >= MAX_COLLECT) {
      state.truncated = true;
      continue;
    }
    const slice = chunk.subarray(0, MAX_COLLECT - state.bytes);
    if (slice.length < chunk.length) state.truncated = true;
    state.bytes += slice.length;
    state.chunks.push(slice);
  }
  await log?.write(decoder.decode(), channel);
}

function normalizeOutput(text: string): string {
  return Bun.stripANSI(text).replaceAll("\r\n", "\n").trimEnd();
}

function resultFor(data: BashData, timeoutMs: number): ToolResult {
  const after = ` after ${seconds(data.durationMs)}`;
  const trailer = `${data.truncated ? "[output truncated at 2MB]\n" : ""}[exit ${data.exitCode ?? "none"}, ${seconds(data.durationMs)}]`;
  if (data.resourceError) {
    return { ok: false, output: data.output, trailer, error: data.resourceError, data };
  }
  if (data.aborted) {
    return {
      ok: false,
      output: data.output,
      trailer,
      error: `Command aborted${after}`,
      data,
    };
  }
  if (data.timedOut) {
    return {
      ok: false,
      output: data.output,
      trailer,
      error: `Command timed out after ${timeoutMs}ms`,
      data,
    };
  }
  if (data.exitCode !== 0) {
    return {
      ok: false,
      output: data.output,
      trailer,
      error: `Command exited with code ${data.exitCode}${after}`,
      data,
    };
  }
  return {
    ok: true,
    output: data.output,
    trailer,
    data,
  };
}

async function runBashSandboxed(
  args: BashArgs,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
  policy: OsSandboxContext,
  deps: BashSandboxDeps,
  resourceLimits: TerminalResourceLimits,
  log: ProcessOutputLog | undefined,
): Promise<ToolResult> {
  const detection = deps.detect();
  const started = performance.now();
  const data: BashData = {
    kind: "terminal",
    command: args.command,
    exitCode: null,
    output: "",
    truncated: false,
    timedOut: false,
    aborted: false,
    sandboxed: false,
    durationMs: 0,
  };

  if (detection.kind === "none") {
    return {
      ok: false,
      output: "",
      error: `OS sandbox unavailable: ${detection.reason}`,
      data,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let result: RunSandboxResult;
  try {
    result = await deps.run({
      workspaceRoot: policy.workspaceRoot,
      cwd,
      allowNetwork: policy.allowNetwork,
      envAllowlist: policy.envAllowlist,
      ...(policy.writablePaths ? { writablePaths: policy.writablePaths } : {}),
      ...(policy.readOnlyPaths ? { readOnlyPaths: policy.readOnlyPaths } : {}),
      ...(policy.readDeniedPaths ? { readDeniedPaths: policy.readDeniedPaths } : {}),
      command: "bash",
      args: ["-lc", args.command],
      signal: controller.signal,
      detection,
      resourceLimits,
      ...(log
        ? { onOutput: (text: string, channel: "stdout" | "stderr") => log.write(text, channel) }
        : {}),
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }

  if (!result.supported) {
    return {
      ok: false,
      output: "",
      error: `OS sandbox failed to start: ${result.reason ?? "unknown error"}`,
      data,
    };
  }

  const truncated = result.output.endsWith(SANDBOX_TRUNCATION_MARKER);
  const raw = truncated ? result.output.slice(0, -SANDBOX_TRUNCATION_MARKER.length) : result.output;
  data.output = normalizeOutput(raw);
  data.truncated = truncated;
  data.timedOut = timedOut;
  data.aborted = signal.aborted;
  data.exitCode = data.aborted ? 130 : timedOut ? 124 : result.exitCode;
  data.sandboxed = true;
  data.durationMs = Math.round(performance.now() - started);
  if (result.resourceError) data.resourceError = result.resourceError;
  return { ...resultFor(data, timeoutMs), ...(log ? { fullOutputPath: log.path } : {}) };
}

export async function runBash(
  args: BashArgs,
  context: BashContext,
  deps: BashSandboxDeps = defaultSandboxDeps,
): Promise<ToolResult> {
  const cwd = resolveToolPath(context.cwd, args.cwd ?? ".");
  try {
    const info = await stat(cwd);
    if (!info.isDirectory()) {
      return { ok: false, output: "", error: `Not a directory: ${args.cwd ?? "."}` };
    }
  } catch {
    return { ok: false, output: "", error: `Working directory not found: ${args.cwd ?? "."}` };
  }

  const timeoutMs = Math.min(args.timeoutMs ?? context.limits.bashTimeoutMs, MAX_TIMEOUT_MS);
  const resourceLimits = context.terminals?.settings.limits ?? DEFAULT_TERMINAL_SETTINGS.limits;
  const log = context.logDir
    ? await ProcessOutputLog.open(context.logDir, context.secrets, context.reportOutput)
    : undefined;
  if (context.osSandbox?.enabled) {
    try {
      return await runBashSandboxed(
        args,
        cwd,
        timeoutMs,
        context.signal,
        context.osSandbox,
        deps,
        resourceLimits,
        log,
      );
    } finally {
      await log?.close();
    }
  }

  const setsid = Bun.which("setsid");
  const shell = context.terminals?.settings.shell ?? defaultTerminalShell();
  const shellArgs = shellCommandArgs(shell, args.command);
  const started = performance.now();
  const scope = createProcessScope();
  const spawn = () =>
    Bun.spawn({
      cmd: withResourceLimits(
        setsid === null ? [shell, ...shellArgs] : [setsid, shell, ...shellArgs],
        resourceLimits,
      ),
      cwd,
      env: { ...(context.env ?? process.env), LIQUID: "1", FLECTEN: "1", ...scope.environment },
      stdout: "pipe",
      stderr: "pipe",
    });
  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn();
    scope.attach(proc.pid);
  } catch (error) {
    await log?.close();
    throw error;
  }
  const isolated = setsid !== null;
  let resourceError: string | undefined;
  const monitor = new ResourceMonitor(
    () => ({ pid: proc.pid, isolated }),
    resourceLimits,
    (message) => {
      resourceError = message;
      killProcessTree(proc.pid, "SIGKILL", isolated);
    },
  );
  monitor.start(100);
  const exited = proc.exited.then((code) => {
    killProcessTree(proc.pid, "SIGKILL", isolated);
    return code;
  });

  let timedOut = false;
  let aborted = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcessTree(proc.pid, "SIGKILL", isolated);
  }, timeoutMs);
  const abort = () => {
    aborted = true;
    killProcessTree(proc.pid, "SIGKILL", isolated);
  };
  if (context.signal.aborted) abort();
  else context.signal.addEventListener("abort", abort, { once: true });

  const state = { bytes: 0, truncated: false, chunks: [] as Uint8Array[] };
  const readers = [
    collect(proc.stdout, state, log, "stdout"),
    collect(proc.stderr, state, log, "stderr"),
  ] as const;
  let exitCode: number;
  try {
    [, , exitCode] = await Promise.all([readers[0], readers[1], exited]);
  } finally {
    clearTimeout(timer);
    monitor.stop();
    context.signal.removeEventListener("abort", abort);
    killProcessTree(proc.pid, "SIGKILL", isolated);
    await Promise.allSettled(readers);
    await log?.close();
  }
  const combined = new TextDecoder().decode(Buffer.concat(state.chunks));

  const data: BashData = {
    kind: "terminal",
    command: args.command,
    exitCode: aborted ? 130 : timedOut ? 124 : exitCode,
    output: normalizeOutput(combined),
    truncated: state.truncated,
    timedOut,
    aborted,
    sandboxed: false,
    durationMs: Math.round(performance.now() - started),
    ...(resourceError ? { resourceError } : {}),
  };

  return { ...resultFor(data, timeoutMs), ...(log ? { fullOutputPath: log.path } : {}) };
}

/** The bash tool: foreground runs between two workspace snapshots, background runs as a job. */
export function runBashTool(args: BashArgs, context: ToolContext): Promise<ToolResult> {
  const cwd = resolveToolPath(context.cwd, args.cwd ?? ".");
  if (args.background) return startBackgroundBash(args, context, cwd);
  return withShellCheckpoint(context, { tool: "bash", command: args.command, cwd }, () =>
    runBash(args, context),
  );
}
