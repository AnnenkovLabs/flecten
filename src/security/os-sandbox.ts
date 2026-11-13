import { existsSync, realpathSync } from "node:fs";
import { createProcessScope } from "../terminal/process-scope";
import { killProcessTree } from "../terminal/process-tree";
import { ResourceMonitor, withResourceLimits } from "../terminal/resources";
import type { TerminalResourceLimits } from "../terminal/settings";
import { canonicalPath } from "../util/canonical-path";
import { bubblewrapProtectionArgs, sandboxProtection } from "./sandbox-protection";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const SYSTEM_READ_PATHS = [
  "/System",
  "/Library",
  "/usr/lib",
  "/usr/local/lib",
  "/bin",
  "/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/private/var/db/dyld",
  "/private/etc",
  "/etc",
] as const;

export type SandboxKind = "bubblewrap" | "seatbelt" | "none";

export type SandboxDetection = {
  kind: SandboxKind;
  command?: string;
  reason: string;
};

export type DetectSandboxOptions = {
  platform?: NodeJS.Platform;
  which?: (name: string) => string | null;
  exists?: (path: string) => boolean;
};

export type SandboxPolicy = {
  workspaceRoot: string;
  cwd: string;
  allowNetwork: boolean;
  writablePaths?: string[];
  readOnlyPaths?: string[];
  readDeniedPaths?: string[];
  envAllowlist?: string[];
};

export type SandboxCommandOptions = SandboxPolicy & {
  command: string;
  args: string[];
};

export type RunSandboxOptions = SandboxCommandOptions & {
  timeoutMs?: number;
  signal?: AbortSignal;
  detection?: SandboxDetection;
  resourceLimits?: TerminalResourceLimits;
  onOutput?(text: string, channel: "stdout" | "stderr"): Promise<void>;
};

export type RunSandboxResult = {
  supported: boolean;
  exitCode: number | null;
  output: string;
  reason?: string;
  resourceError?: string;
};

export function detectSandbox(options: DetectSandboxOptions = {}): SandboxDetection {
  const platform = options.platform ?? process.platform;
  const which = options.which ?? ((name: string) => Bun.which(name));
  const exists = options.exists ?? existsSync;

  if (platform === "linux") {
    const command = which("bwrap");
    if (command !== null) {
      return { kind: "bubblewrap", command, reason: `bwrap найден: ${command}.` };
    }
    return { kind: "none", reason: "bwrap не найден: OS-level sandbox недоступен." };
  }

  if (platform === "darwin") {
    if (exists(SANDBOX_EXEC)) {
      return {
        kind: "seatbelt",
        command: SANDBOX_EXEC,
        reason: `sandbox-exec найден: ${SANDBOX_EXEC}.`,
      };
    }
    return {
      kind: "none",
      reason: `${SANDBOX_EXEC} не найден: OS-level sandbox недоступен.`,
    };
  }

  return {
    kind: "none",
    reason: `Платформа ${platform} не поддерживает OS-level sandbox.`,
  };
}

export function buildBubblewrapArgs(options: SandboxCommandOptions): string[] {
  // envAllowlist is applied to Bun.spawn's env: bwrap inherits a sanitized
  // environment, so values never appear in argv or the process list.
  const args = ["--ro-bind", "/", "/", "--tmpfs", "/tmp"];

  for (const path of uniquePaths([options.workspaceRoot, ...(options.writablePaths ?? [])])) {
    if (path === "/tmp") continue;
    args.push("--bind", path, path);
  }
  for (const path of uniquePaths(options.readOnlyPaths ?? [])) {
    const target = existsSync(path) ? realpathSync(path) : path;
    if (target !== "/tmp") args.push("--ro-bind", target, target);
  }
  args.push(...bubblewrapProtectionArgs(options));

  args.push("--proc", "/proc", "--dev", "/dev");
  if (!options.allowNetwork) args.push("--unshare-net");
  args.push("--chdir", options.cwd, "--die-with-parent", "--", options.command, ...options.args);
  return args;
}

export function buildSeatbeltProfile(policy: SandboxPolicy): string {
  const writable = uniquePaths(
    [policy.workspaceRoot, ...(policy.writablePaths ?? [])].flatMap((path) => [
      path,
      canonicalPath(path),
    ]),
  );
  const protection = sandboxProtection(policy);
  const readOnly = protection.readOnly;
  const readable = uniquePaths([
    ...SYSTEM_READ_PATHS,
    "/tmp",
    "/private/tmp",
    policy.workspaceRoot,
    ...writable,
    ...readOnly,
  ]);

  // ponytail: Seatbelt profile is deliberately small. It has no CPU, memory,
  // process-count limits and no hostname filtering. Extend it only with tests
  // on a real macOS host because rule precedence is not a stable public contract.
  const lines = [
    "(version 1)",
    "(deny default)",
    "",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "",
    "(allow file-read*",
    '  (literal "/")',
    ...readable.map((path) => `  (subpath ${JSON.stringify(path)})`),
    '  (literal "/dev/null")',
    '  (literal "/dev/urandom")',
    '  (literal "/dev/random")',
    '  (literal "/dev/tty")',
    ")",
    "",
    "(allow file-write*",
    '  (literal "/dev/null")',
    '  (literal "/dev/tty")',
    '  (subpath "/tmp")',
    '  (subpath "/private/tmp")',
    ...writable.map((path) => `  (subpath ${JSON.stringify(path)})`),
    ")",
  ];

  if (readOnly.length > 0) {
    lines.push(
      "",
      "(deny file-write*",
      ...readOnly.map((path) => `  (subpath ${JSON.stringify(path)})`),
      ")",
    );
  }
  if (protection.readDenied.length > 0)
    lines.push(
      "",
      "(deny file-read*",
      ...protection.readDenied.map((path) => `  (subpath ${JSON.stringify(path)})`),
      ")",
    );

  lines.push("", policy.allowNetwork ? "(allow network*)" : "(deny network*)");
  return `${lines.join("\n")}\n`;
}

export async function runSandboxed(options: RunSandboxOptions): Promise<RunSandboxResult> {
  const detection = options.detection ?? detectSandbox();
  if (detection.kind === "none") {
    return { supported: false, exitCode: null, output: "", reason: detection.reason };
  }

  if (options.signal?.aborted) {
    return { supported: true, exitCode: 130, output: "", reason: "Command aborted." };
  }

  const command =
    detection.kind === "bubblewrap"
      ? [detection.command ?? "bwrap", ...buildBubblewrapArgs(options)]
      : [
          detection.command ?? SANDBOX_EXEC,
          "-p",
          buildSeatbeltProfile(options),
          options.command,
          ...options.args,
        ];

  const scope = createProcessScope();
  const spawn = () =>
    Bun.spawn({
      cmd: options.resourceLimits ? withResourceLimits(command, options.resourceLimits) : command,
      cwd: options.cwd,
      env: { ...allowlistedEnv(options.envAllowlist ?? []), ...scope.environment },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    });

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn();
    scope.attach(proc.pid);
  } catch (cause) {
    return {
      supported: false,
      exitCode: null,
      output: "",
      reason: `Не удалось запустить ${detection.kind}: ${errorMessage(cause)}.`,
    };
  }

  let timedOut = false;
  let aborted = false;
  const kill = (): void => {
    killProcessTree(proc.pid, "SIGKILL", true);
  };
  let resourceError: string | undefined;
  const monitor = options.resourceLimits
    ? new ResourceMonitor(
        () => ({ pid: proc.pid, isolated: true }),
        options.resourceLimits,
        (message) => {
          resourceError = message;
          kill();
        },
      )
    : undefined;
  monitor?.start(100);
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);
  const abort = (): void => {
    aborted = true;
    kill();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();

  const state = { bytes: 0, truncated: false };
  let stdout: string;
  let stderr: string;
  let code: number;
  const readers = [
    collect(proc.stdout, state, "stdout", options.onOutput),
    collect(proc.stderr, state, "stderr", options.onOutput),
  ] as const;
  try {
    [stdout, stderr, code] = await Promise.all([
      readers[0],
      readers[1],
      proc.exited.then((exitCode) => {
        kill();
        return exitCode;
      }),
    ]);
  } finally {
    clearTimeout(timer);
    monitor?.stop();
    options.signal?.removeEventListener("abort", abort);
    kill();
    await Promise.allSettled(readers);
  }
  let output = `${stdout}${stderr}`.trimEnd();
  if (state.truncated) output += "\n[output truncated]";

  if (resourceError) return { supported: true, exitCode: code, output, resourceError };

  if (aborted) {
    return { supported: true, exitCode: 130, output, reason: "Command aborted." };
  }
  if (timedOut) {
    return {
      supported: true,
      exitCode: 124,
      output,
      reason: `Command timed out after ${timeoutMs}ms.`,
    };
  }
  return { supported: true, exitCode: code, output };
}

type OutputState = {
  bytes: number;
  truncated: boolean;
};

async function collect(
  stream: ReadableStream<Uint8Array>,
  state: OutputState,
  channel: "stdout" | "stderr",
  onOutput?: RunSandboxOptions["onOutput"],
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    const decoded = decoder.decode(chunk, { stream: true });
    await onOutput?.(decoded, channel);
    const remaining = MAX_OUTPUT_BYTES - state.bytes;
    if (remaining <= 0) {
      state.truncated = true;
      continue;
    }
    const slice = chunk.subarray(0, remaining);
    if (slice.length < chunk.length) state.truncated = true;
    state.bytes += slice.length;
    text += slice.length === chunk.length ? decoded : new TextDecoder().decode(slice);
  }
  const final = decoder.decode();
  await onOutput?.(final, channel);
  return text + final;
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((path) => path.length > 0))];
}

function allowlistedEnv(names: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
