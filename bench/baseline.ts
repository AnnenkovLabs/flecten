import { rm } from "node:fs/promises";
import { evaluateChecks, type CheckOutcome } from "./checks";
import { createFixture } from "./fixture";
import type { BenchTask } from "./schema";

export interface BaselineRunReport {
  id: string;
  status: "passed" | "failed" | "unscored";
  durationMs: number;
  checksPassed: number;
  checksTotal: number;
  exitCode: number | null;
  checks: CheckOutcome[];
  error?: string;
}

export interface BaselineReport {
  name: "codex";
  status: "skipped" | "ran";
  reason?: string;
  command?: string;
  runs: BaselineRunReport[];
}

export interface BaselineOptions {
  env: Record<string, string | undefined>;
}

function skipped(reason: string): BaselineReport {
  return { name: "codex", status: "skipped", reason, runs: [] };
}

function timeoutOf(env: Record<string, string | undefined>): number {
  const raw = env.BENCH_CODEX_TIMEOUT_MS;
  if (raw === undefined || raw.trim().length === 0) return 600_000;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("BENCH_CODEX_TIMEOUT_MS must be a positive number");
  }
  return Math.round(value);
}

function spawnEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function errorText(proc: ReturnType<typeof Bun.spawnSync>): string {
  const stderr = proc.stderr?.toString().trim() ?? "";
  if (stderr.length > 0) return stderr.slice(0, 500);
  return `codex exited with code ${String(proc.exitCode)}`;
}

export async function runBaseline(
  tasks: BenchTask[],
  options: BaselineOptions,
): Promise<BaselineReport> {
  if (options.env.BENCH_CODEX_CLI !== "1") {
    return skipped("BENCH_CODEX_CLI is not set");
  }
  const bin = options.env.BENCH_CODEX_BIN ?? "codex";
  const path = options.env.PATH ?? process.env.PATH;
  const located = path === undefined ? Bun.which(bin) : Bun.which(bin, { PATH: path });
  if (located === null) return skipped(`Codex CLI not found: ${bin}`);

  const timeout = timeoutOf(options.env);
  const env = spawnEnv(options.env);
  const runs: BaselineRunReport[] = [];
  for (const task of tasks) {
    const cwd = await createFixture(task.files);
    try {
      const started = performance.now();
      const proc = Bun.spawnSync({
        cmd: [
          located,
          "exec",
          "--sandbox",
          "workspace-write",
          "-c",
          "approval_policy=never",
          "--ephemeral",
          "--skip-git-repo-check",
          "--color",
          "never",
          task.prompt,
        ],
        cwd,
        env,
        timeout,
        stdout: "pipe",
        stderr: "pipe",
      });
      const durationMs = Math.round(performance.now() - started);
      if (!proc.success) {
        runs.push({
          id: task.id,
          status: "failed",
          durationMs,
          checksPassed: 0,
          checksTotal: 0,
          exitCode: proc.exitCode,
          checks: [],
          error: errorText(proc),
        });
        continue;
      }
      const checks = await evaluateChecks(task.checks, cwd);
      const evaluable = checks.filter((check) => check.ok !== null);
      const checksPassed = evaluable.filter((check) => check.ok === true).length;
      runs.push({
        id: task.id,
        status:
          evaluable.length === 0
            ? "unscored"
            : checksPassed === evaluable.length
              ? "passed"
              : "failed",
        durationMs,
        checksPassed,
        checksTotal: evaluable.length,
        exitCode: proc.exitCode,
        checks,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return { name: "codex", status: "ran", command: located, runs };
}
