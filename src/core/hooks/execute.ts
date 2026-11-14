import { createProcessScope } from "../../terminal/process-scope";
import { killProcessTree } from "../../terminal/process-tree";
import { defaultTerminalShell } from "../../terminal/settings";
import { buildEnvironment, shellCommand } from "../../terminal/shell";
import type { HookDefinition, HookInput, HookName } from "./types";

export const MAX_HOOK_REQUEST_BYTES = 64 * 1024;
const MAX_HOOK_RESPONSE_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 60_000;

export interface Captured {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
  outputTruncated: boolean;
  error: string | undefined;
}

function failed(error: string): Captured {
  return {
    stdout: "",
    stderr: "",
    exitCode: -1,
    timedOut: false,
    aborted: false,
    outputTruncated: false,
    error,
  };
}

function abortedCapture(): Captured {
  return {
    stdout: "",
    stderr: "",
    exitCode: -1,
    timedOut: false,
    aborted: true,
    outputTruncated: false,
    error: undefined,
  };
}

function boundedTimeout(timeoutMs: number): number {
  return Math.min(Math.max(timeoutMs, 1), MAX_TIMEOUT_MS);
}

function prepareRequest(event: HookName, input: HookInput): { body: string } | { error: string } {
  let body: string;
  try {
    body = JSON.stringify({ ...input, event });
  } catch (error) {
    return {
      error: `hook input is not serializable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_HOOK_REQUEST_BYTES) {
    return { error: `hook request exceeds ${MAX_HOOK_REQUEST_BYTES} bytes` };
  }
  return { body };
}

interface Collected {
  text: string;
  truncated: boolean;
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  onOverflow?: () => void,
): Promise<Collected> {
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for await (const chunk of stream) {
    const slice = chunk.subarray(0, MAX_HOOK_RESPONSE_BYTES - bytes);
    bytes += slice.length;
    text += decoder.decode(slice, { stream: true });
    if (slice.length < chunk.length) {
      onOverflow?.();
      return { text: text + decoder.decode(), truncated: true };
    }
  }
  return { text: text + decoder.decode(), truncated: false };
}

function outputFailure(stdout: Collected, stderr?: Collected): string | undefined {
  return stdout.truncated || stderr?.truncated
    ? `hook output exceeds ${MAX_HOOK_RESPONSE_BYTES} bytes`
    : undefined;
}

async function runCommand(
  hook: HookDefinition,
  event: HookName,
  body: string,
  cwd: string,
  signal: AbortSignal,
): Promise<Captured> {
  if (!hook.command?.trim()) return failed("hook command is empty");
  if (signal.aborted) return abortedCapture();

  const shell = defaultTerminalShell();
  const setsid = process.platform === "win32" ? null : Bun.which("setsid");
  const execution = shellCommand(shell, hook.command);
  const scope = createProcessScope();
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn({
      ...execution,
      cmd: [...(setsid ? [setsid] : []), ...execution.cmd],
      cwd,
      env: {
        ...buildEnvironment(cwd, shell, hook.env, hook.envAllowlist),
        ...scope.environment,
        LIQUID: "1",
        FLECTEN: "1",
        FLECTEN_HOOK_EVENT: event,
        LIQUID_HOOK_EVENT: event,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    scope.attach(proc.pid);
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }

  let timedOut = false;
  let aborted = false;
  const stop = () => killProcessTree(proc.pid, "SIGKILL", setsid !== null);
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, boundedTimeout(hook.timeoutMs));
  const abort = () => {
    aborted = true;
    stop();
  };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });

  const readers = [collect(proc.stdout, stop), collect(proc.stderr, stop)] as const;
  const exited = proc.exited.then((exitCode) => {
    stop();
    return exitCode;
  });
  try {
    try {
      proc.stdin.write(`${body}\n`);
      await proc.stdin.end();
    } catch {
      // Commands may finish without reading stdin; their exit status remains authoritative.
    }
    const [stdout, stderr, exitCode] = await Promise.all([readers[0], readers[1], exited]);
    return {
      stdout: stdout.text,
      stderr: stderr.text,
      exitCode,
      timedOut,
      aborted,
      outputTruncated: stdout.truncated || stderr.truncated,
      error: outputFailure(stdout, stderr),
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    stop();
    await Promise.allSettled(readers);
  }
}

function transportFailed(timedOut: boolean, signal: AbortSignal, error: unknown): Captured {
  if (timedOut) {
    return {
      stdout: "",
      stderr: "",
      exitCode: -1,
      timedOut: true,
      aborted: false,
      outputTruncated: false,
      error: undefined,
    };
  }
  if (signal.aborted) return abortedCapture();
  return failed(error instanceof Error ? error.message : String(error));
}

async function runHttp(
  hook: HookDefinition,
  event: HookName,
  body: string,
  signal: AbortSignal,
): Promise<Captured> {
  if (!hook.url) return failed("hook URL is empty");
  let url: URL;
  try {
    url = new URL(hook.url);
  } catch {
    return failed("hook URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return failed("hook URL must use http or https");
  }
  if (signal.aborted) return abortedCapture();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, boundedTimeout(hook.timeoutMs));
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...hook.headers,
        "content-type": "application/json",
        "x-flecten-hook-event": event,
        "x-liquid-hook-event": event,
      },
      body,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return failed(`hook HTTP ${response.status}`);
    }
    const stdout = response.body ? await collect(response.body) : { text: "", truncated: false };
    return {
      stdout: stdout.text,
      stderr: "",
      exitCode: 0,
      timedOut,
      aborted: signal.aborted,
      outputTruncated: stdout.truncated,
      error: outputFailure(stdout),
    };
  } catch (error) {
    return transportFailed(timedOut, signal, error);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

function isHttp(hook: HookDefinition): boolean {
  if (hook.type === "http") return true;
  if (hook.type === "command") return false;
  return hook.url !== undefined && hook.command === undefined;
}

export async function executeHook(
  hook: HookDefinition,
  event: HookName,
  input: HookInput,
  cwd: string,
  signal: AbortSignal,
): Promise<Captured> {
  const request = prepareRequest(event, input);
  if ("error" in request) return failed(request.error);
  if (isHttp(hook)) return runHttp(hook, event, request.body, signal);
  return runCommand(hook, event, request.body, cwd, signal);
}
