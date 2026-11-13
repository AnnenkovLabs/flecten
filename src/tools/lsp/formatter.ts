import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type DiffResult, diffText } from "../util/diff";
import { isInside } from "../util/paths";
import { childEnv, DEFAULT_TIMEOUT_MS, type ResolvedFormatter } from "./config";

const MAX_TIMEOUT_MS = 60_000;

// ponytail: the target and cwd stay inside the workspace, but a hostile formatter
// binary could still write elsewhere. Run it under the OS sandbox when that matters.

export type FormatterOutcome =
  | { ok: true; changed: boolean; diff: DiffResult }
  | { ok: false; error: string };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function timeoutOf(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(value, MAX_TIMEOUT_MS);
}

function buildArgs(definition: ResolvedFormatter["definition"], file: string): string[] {
  const configured = definition.args ?? [];
  const hasPlaceholder = configured.some((arg) => arg.includes("{file}"));
  const args = configured.map((arg) => arg.replaceAll("{file}", file));
  if (!hasPlaceholder) args.push(file);
  return args;
}

async function realPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

export async function runFormatter(
  resolved: ResolvedFormatter,
  file: string,
  workspace: string,
  display: string,
  signal: AbortSignal,
): Promise<FormatterOutcome> {
  if (signal.aborted) return { ok: false, error: `Formatter cancelled: ${display}` };
  const target = await realPath(file);
  const root = await realPath(workspace);
  if (!isInside(workspace, file) || !isInside(root, target)) {
    return { ok: false, error: `Refusing to format outside the workspace: ${display}` };
  }

  let original: string;
  try {
    original = await readFile(file, "utf8");
  } catch {
    return { ok: false, error: `Cannot read ${display}` };
  }

  const definition = resolved.definition;
  const timeoutMs = timeoutOf(definition.timeoutMs);
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn([definition.command, ...buildArgs(definition, file)], {
      cwd: resolved.root,
      env: childEnv(definition.env, definition.envAllowlist),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      ok: false,
      error: `Formatter not found: ${definition.command}: ${asError(error).message}`,
    };
  }

  const write = proc.stdin.write(original);
  if (typeof write !== "number") void write.catch(() => undefined);
  void Promise.resolve(proc.stdin.end()).catch(() => undefined);

  let timedOut = false;
  let cancelled = false;
  const kill = () => {
    try {
      proc.kill("SIGKILL");
    } catch {
      return;
    }
  };
  const onAbort = () => {
    cancelled = true;
    kill();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  clearTimeout(timer);
  signal.removeEventListener("abort", onAbort);
  const stdout = await stdoutPromise;
  const stderr = await stderrPromise;

  let after = original;
  let present = true;
  try {
    after = await readFile(file, "utf8");
  } catch {
    present = false;
  }
  if (!present || after !== original) {
    try {
      await writeFile(file, original, "utf8");
    } catch (error) {
      return {
        ok: false,
        error: `Formatter changed ${display} and the file could not be restored: ${asError(error).message}`,
      };
    }
  }

  if (timedOut) {
    return { ok: false, error: `Formatter timed out after ${timeoutMs}ms: ${definition.command}` };
  }
  if (cancelled) return { ok: false, error: `Formatter cancelled: ${definition.command}` };
  if (exitCode !== 0) {
    const detail = stderr.trim();
    const suffix = detail ? `: ${detail}` : "";
    return {
      ok: false,
      error: `Formatter exited with code ${exitCode}: ${definition.command}${suffix}`,
    };
  }

  const formatted = after !== original ? after : stdout;
  return { ok: true, changed: formatted !== original, diff: diffText(original, formatted) };
}
