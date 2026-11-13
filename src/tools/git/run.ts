import type { ToolResult } from "../../core/types";
import type { GitArgs, GitOperation } from "./schema";

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_DIFF_LINES = 400;
const SAFE_COMMAND_CHARS =
  "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@%+=:,./_-";

interface GitExecution {
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
}

interface CollectState {
  bytes: number;
  truncated: boolean;
}

function quoteCommandPart(part: string): string {
  if (part.length > 0 && [...part].every((char) => SAFE_COMMAND_CHARS.includes(char))) return part;
  return `'${part.replaceAll("'", "'\\''")}'`;
}

function formatCommandLine(command: string[]): string {
  return command.map(quoteCommandPart).join(" ");
}

async function collect(stream: ReadableStream<Uint8Array>, state: CollectState): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    if (state.bytes >= MAX_OUTPUT_BYTES) {
      state.truncated = true;
      continue;
    }
    const slice = chunk.subarray(0, MAX_OUTPUT_BYTES - state.bytes);
    if (slice.length < chunk.length) state.truncated = true;
    state.bytes += slice.length;
    text += decoder.decode(slice, { stream: true });
  }
  return text + decoder.decode();
}

async function executeGit(
  command: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<GitExecution> {
  const readOnly = command[0] !== "commit";
  const argv = [
    "git",
    ...(readOnly ? ["--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false"] : []),
    ...command,
  ];
  const started = performance.now();
  if (signal.aborted) {
    return {
      command: argv,
      stdout: "",
      stderr: "",
      exitCode: 130,
      truncated: false,
      timedOut: false,
      aborted: true,
      durationMs: 0,
    };
  }

  const proc = Bun.spawn(argv, {
    cwd,
    env: {
      ...process.env,
      GIT_PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
      NO_COLOR: "1",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  let aborted = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, TIMEOUT_MS);
  const abort = () => {
    aborted = true;
    proc.kill("SIGKILL");
  };
  signal.addEventListener("abort", abort, { once: true });

  const state: CollectState = { bytes: 0, truncated: false };
  const [stdout, stderr, exitCode] = await Promise.all([
    collect(proc.stdout, state),
    collect(proc.stderr, state),
    proc.exited,
  ]);
  clearTimeout(timer);
  signal.removeEventListener("abort", abort);

  return {
    command: argv,
    stdout: stdout.replaceAll("\r\n", "\n"),
    stderr: stderr.replaceAll("\r\n", "\n"),
    exitCode: aborted ? 130 : timedOut ? 124 : exitCode,
    truncated: state.truncated,
    timedOut,
    aborted,
    durationMs: Math.round(performance.now() - started),
  };
}

function executionBody(execution: GitExecution): string {
  const parts = [execution.stdout.trimEnd(), execution.stderr.trimEnd()].filter(
    (part) => part.length > 0,
  );
  return parts.length > 0 ? parts.join("\n") : "(no output)";
}

function formatExecution(execution: GitExecution, notes: string[] = []): string {
  return [
    `$ ${formatCommandLine(execution.command)}`,
    `exit code: ${execution.exitCode}`,
    "",
    executionBody(execution),
    ...notes,
  ].join("\n");
}

function executionData(operation: GitOperation, execution: GitExecution, cwd: string) {
  return {
    kind: "git",
    operation,
    command: execution.command,
    commandLine: formatCommandLine(execution.command),
    cwd,
    exitCode: execution.exitCode,
    stdout: execution.stdout,
    stderr: execution.stderr,
    truncated: execution.truncated,
    timedOut: execution.timedOut,
    aborted: execution.aborted,
    durationMs: execution.durationMs,
  };
}

function capLines(text: string, maxLines: number): { text: string; omitted: number } {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { text, omitted: 0 };
  return { text: lines.slice(0, maxLines).join("\n"), omitted: lines.length - maxLines };
}

function resultFor(args: GitArgs, execution: GitExecution, cwd: string): ToolResult {
  const notes: string[] = [];
  let stdout = execution.stdout;
  let linesOmitted = 0;
  if (args.operation === "diff") {
    const capped = capLines(stdout, args.maxLines ?? DEFAULT_DIFF_LINES);
    stdout = capped.text;
    linesOmitted = capped.omitted;
  }
  if (execution.truncated) notes.push(`[output truncated at ${MAX_OUTPUT_BYTES} bytes]`);
  if (linesOmitted > 0) notes.push(`[${linesOmitted} lines omitted; raise maxLines]`);

  const shown: GitExecution = { ...execution, stdout };
  const output = formatExecution(shown, notes);
  const data = {
    ...executionData(args.operation, execution, cwd),
    truncated: execution.truncated || linesOmitted > 0,
    linesOmitted,
  };

  if (execution.aborted) {
    return { ok: false, output, error: `git ${args.operation} aborted`, data };
  }
  if (execution.timedOut) {
    return {
      ok: false,
      output,
      error: `git ${args.operation} timed out after ${TIMEOUT_MS}ms`,
      data,
    };
  }
  if (execution.exitCode !== 0) {
    return {
      ok: false,
      output,
      error: `git ${args.operation} exited with code ${execution.exitCode}`,
      data,
    };
  }
  return { ok: true, output, data };
}

function buildCommand(args: GitArgs): string[] {
  switch (args.operation) {
    case "status":
      return ["status", "--short", "--branch"];
    case "diff": {
      const command = ["diff", "--no-ext-diff", "--no-textconv"];
      if (args.staged) command.push("--cached");
      if (args.path) command.push("--", args.path);
      return command;
    }
    case "log":
      return ["log", `--max-count=${args.maxCount ?? 20}`, "--oneline", "--decorate"];
    case "show": {
      const command = [
        "show",
        "--no-ext-diff",
        "--no-textconv",
        "--stat",
        "--patch",
        args.rev ?? "HEAD",
      ];
      if (args.path) command.push("--", args.path);
      return command;
    }
    case "branch":
      return ["branch", "--list", "--verbose"];
    case "commit":
      return ["commit", "-m", args.message ?? ""];
  }
}

function validate(args: GitArgs): string | undefined {
  if (args.staged !== undefined && args.operation !== "diff") {
    return "staged is only valid for diff";
  }
  if (args.maxLines !== undefined && args.operation !== "diff") {
    return "maxLines is only valid for diff";
  }
  if (args.maxCount !== undefined && args.operation !== "log") {
    return "maxCount is only valid for log";
  }
  if (args.rev !== undefined && args.operation !== "show") {
    return "rev is only valid for show";
  }
  if (args.rev?.startsWith("-")) {
    return "rev must be a revision, not an option";
  }
  if (args.path !== undefined && args.operation !== "diff" && args.operation !== "show") {
    return "path is only valid for diff and show";
  }
  if (args.operation === "commit") {
    if (args.allowCommit !== true) return "commit requires allowCommit=true";
    if (!args.message || args.message.trim().length === 0) {
      return "commit requires a non-empty message";
    }
    return undefined;
  }
  if (args.message !== undefined) return "message is only valid for commit";
  if (args.allowCommit !== undefined) return "allowCommit is only valid for commit";
  return undefined;
}

function refusal(command: string[], cwd: string, reason: string, detail: string): ToolResult {
  const commandLine = formatCommandLine(command);
  return {
    ok: false,
    output: `$ ${commandLine}\nexit code: not run\n\n${detail}`,
    error: reason,
    data: {
      kind: "git",
      operation: "commit",
      command,
      commandLine,
      cwd,
      exitCode: null,
      refused: true,
      reason,
    },
  };
}

async function runCommit(args: GitArgs, cwd: string, signal: AbortSignal): Promise<ToolResult> {
  const check = await executeGit(["diff", "--cached", "--name-only"], cwd, signal);
  if (check.aborted) {
    return {
      ok: false,
      output: formatExecution(check),
      error: "git diff --cached --name-only aborted",
      data: executionData("commit", check, cwd),
    };
  }
  if (check.timedOut) {
    return {
      ok: false,
      output: formatExecution(check),
      error: `git diff --cached --name-only timed out after ${TIMEOUT_MS}ms`,
      data: executionData("commit", check, cwd),
    };
  }
  if (check.exitCode !== 0) {
    return {
      ok: false,
      output: formatExecution(check),
      error: `git diff --cached --name-only exited with code ${check.exitCode}`,
      data: executionData("commit", check, cwd),
    };
  }

  const command = buildCommand(args);
  if (check.stdout.trim().length === 0) {
    return refusal(
      ["git", ...command],
      cwd,
      "No staged changes to commit",
      "Refused: no staged changes. Stage files with git add before committing.",
    );
  }

  const execution = await executeGit(command, cwd, signal);
  return resultFor(args, execution, cwd);
}

export async function runGit(
  args: GitArgs,
  context: { cwd: string; signal: AbortSignal },
): Promise<ToolResult> {
  const problem = validate(args);
  if (problem) return { ok: false, output: "", error: problem };

  if (args.operation === "commit") {
    return runCommit(args, context.cwd, context.signal);
  }

  const execution = await executeGit(buildCommand(args), context.cwd, context.signal);
  return resultFor(args, execution, context.cwd);
}
