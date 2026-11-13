import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Usage } from "../src/core/types";
import type { BaselineReport } from "./baseline";
import type { CheckOutcome } from "./checks";
import type { Pricing } from "./pricing";
import { TASK_GROUPS, type BenchTask } from "./schema";
import type { TaskRunResult, TaskStatus } from "./task-runner";

export interface TaskReport {
  id: string;
  group: BenchTask["group"];
  hash: string;
  status: TaskStatus;
  durationMs: number;
  usage: Usage;
  costUsd: number;
  budgetTokens: number;
  withinBudget: boolean;
  turns: number;
  stopReason: string;
  checksPassed: number;
  checksTotal: number;
  checks: CheckOutcome[];
  scriptExhausted: boolean;
  error?: string;
}

export interface GroupReport {
  group: BenchTask["group"];
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  usage: Usage;
  costUsd: number;
}

export interface BenchReport {
  schemaVersion: 1;
  generatedAt: string;
  environment: {
    bun: string;
    platform: string;
    commit: string;
    dirty: boolean;
    cwd: string;
  };
  suiteHash: string;
  pricing: Pricing;
  tasks: TaskReport[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    durationMs: number;
    usage: Usage;
    costUsd: number;
    byGroup: GroupReport[];
  };
  baseline: BaselineReport;
}

export const repoRoot = resolve(import.meta.dir, "..");

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function taskHash(task: BenchTask): string {
  return hashText(JSON.stringify(task));
}

export function suiteHash(tasks: BenchTask[]): string {
  return hashText(tasks.map(taskHash).sort().join("\n"));
}

function emptyUsage(): Usage {
  return { input: 0, output: 0, cached: 0 };
}

function addUsage(left: Usage, right: Usage): Usage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cached: left.cached + right.cached,
  };
}

function git(args: string[]): string | undefined {
  const proc = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!proc.success) return undefined;
  const text = proc.stdout.toString().trim();
  return text.length > 0 ? text : undefined;
}

export function environmentInfo(): BenchReport["environment"] {
  return {
    bun: Bun.version,
    platform: `${process.platform}-${process.arch}`,
    commit: git(["rev-parse", "--short", "HEAD"]) ?? "unknown",
    dirty: (git(["status", "--porcelain"]) ?? "").length > 0,
    cwd: repoRoot,
  };
}

export function taskReport(run: TaskRunResult): TaskReport {
  const checksPassed = run.checks.filter((check) => check.ok === true).length;
  const checksTotal = run.checks.filter((check) => check.ok !== null).length;
  return {
    id: run.task.id,
    group: run.task.group,
    hash: taskHash(run.task),
    status: run.status,
    durationMs: run.durationMs,
    usage: run.usage,
    costUsd: run.costUsd,
    budgetTokens: run.task.budgetTokens,
    withinBudget: run.usage.input + run.usage.output <= run.task.budgetTokens,
    turns: run.turns,
    stopReason: run.stopReason,
    checksPassed,
    checksTotal,
    checks: run.checks,
    scriptExhausted: run.scriptExhausted,
    ...(run.error === undefined ? {} : { error: run.error }),
  };
}

function summarize(tasks: TaskReport[]): BenchReport["summary"] {
  let usage = emptyUsage();
  let costUsd = 0;
  for (const task of tasks) {
    usage = addUsage(usage, task.usage);
    costUsd += task.costUsd;
  }
  const passed = tasks.filter((task) => task.status === "passed").length;
  const errors = tasks.filter((task) => task.status === "error").length;
  const byGroup = TASK_GROUPS.map((group): GroupReport => {
    const members = tasks.filter((task) => task.group === group);
    let groupUsage = emptyUsage();
    let groupCost = 0;
    for (const task of members) {
      groupUsage = addUsage(groupUsage, task.usage);
      groupCost += task.costUsd;
    }
    return {
      group,
      total: members.length,
      passed: members.filter((task) => task.status === "passed").length,
      failed: members.filter((task) => task.status !== "passed").length,
      durationMs: members.reduce((total, task) => total + task.durationMs, 0),
      usage: groupUsage,
      costUsd: Math.round(groupCost * 1e8) / 1e8,
    };
  });
  return {
    total: tasks.length,
    passed,
    failed: tasks.length - passed,
    errors,
    durationMs: tasks.reduce((total, task) => total + task.durationMs, 0),
    usage,
    costUsd: Math.round(costUsd * 1e8) / 1e8,
    byGroup,
  };
}

export function buildReport(input: {
  generatedAt: string;
  tasks: TaskRunResult[];
  pricing: Pricing;
  baseline: BaselineReport;
}): BenchReport {
  const tasks = input.tasks.map(taskReport);
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    environment: environmentInfo(),
    suiteHash: suiteHash(input.tasks.map((run) => run.task)),
    pricing: input.pricing,
    tasks,
    summary: summarize(tasks),
    baseline: input.baseline,
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

function usageLine(usage: Usage): string {
  return `${formatNumber(usage.input)} input / ${formatNumber(usage.output)} output tokens`;
}

function baselineLine(baseline: BaselineReport): string {
  if (baseline.status === "skipped") return `Codex baseline: skipped (${baseline.reason ?? "unavailable"})`;
  const scored = baseline.runs.filter((run) => run.status !== "unscored");
  const passed = scored.filter((run) => run.status === "passed").length;
  return `Codex baseline: ${passed}/${scored.length} scored task(s) passed, ${baseline.runs.length - scored.length} unscored`;
}

export function markdownSummary(report: BenchReport): string {
  const lines = [
    "# Benchmark summary",
    "",
    `Generated ${report.generatedAt}. Commit ${report.environment.commit}${report.environment.dirty ? " (dirty worktree)" : ""}. Bun ${report.environment.bun}, ${report.environment.platform}.`,
    "",
    `${report.summary.passed}/${report.summary.total} tasks passed, ${report.summary.failed} failed (${report.summary.errors} errors), ${formatDuration(report.summary.durationMs)}, ${usageLine(report.summary.usage)}, $${report.summary.costUsd.toFixed(4)} estimated.`,
    "",
    "| Group | Passed | Total | Duration | Tokens | Cost |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const group of report.summary.byGroup) {
    if (group.total === 0) continue;
    lines.push(
      `| ${group.group} | ${group.passed} | ${group.total} | ${formatDuration(group.durationMs)} | ${formatNumber(group.usage.input + group.usage.output)} | $${group.costUsd.toFixed(4)} |`,
    );
  }
  lines.push("", baselineLine(report.baseline), "");
  const failures = report.tasks.filter((task) => task.status !== "passed");
  if (failures.length === 0) {
    lines.push("Failures: none");
  } else {
    lines.push("Failures:");
    for (const task of failures) {
      const failedChecks = task.checks.filter((check) => check.ok !== true);
      const checkText = failedChecks.map((check) => `${check.type}: ${check.detail}`).join("; ");
      const detail = task.error ?? (checkText.length > 0 ? checkText : "no checks");
      lines.push(`- ${task.id} (${task.status}): ${detail}`);
    }
  }
  lines.push(
    "",
    `Pricing source: ${report.pricing.source}. Cost is an estimate from tokens times the configured price table.`,
    "",
  );
  return lines.join("\n");
}

export async function writeReport(
  report: BenchReport,
  outDir: string,
): Promise<{ reportPath: string; summaryPath: string }> {
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "report.json");
  const summaryPath = join(outDir, "summary.md");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(summaryPath, markdownSummary(report));
  return { reportPath, summaryPath };
}
