import { join } from "node:path";
import { runBaseline, type BaselineReport } from "./baseline";
import { pricingFromEnv } from "./pricing";
import { buildReport, writeReport, type BenchReport } from "./report";
import { defaultTasksDir, loadTasks, type BenchTask } from "./schema";
import { runTask, type TaskRunResult } from "./task-runner";

export interface RunBenchOptions {
  tasksDir?: string;
  outDir?: string;
  filter?: string[];
  env?: Record<string, string | undefined>;
  skipBaseline?: boolean;
}

export interface RunBenchResult {
  report: BenchReport;
  reportPath: string;
  summaryPath: string;
}

function selectTasks(tasks: BenchTask[], filter: string[] | undefined): BenchTask[] {
  if (filter === undefined || filter.length === 0) return tasks;
  const known = new Set(tasks.map((task) => task.id));
  const unknown = filter.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`unknown benchmark task ids: ${unknown.join(", ")}`);
  const wanted = new Set(filter);
  return tasks.filter((task) => wanted.has(task.id));
}

function defaultOutDir(generatedAt: string): string {
  return join(import.meta.dir, "results", generatedAt.replaceAll(":", "-").replaceAll(".", "-"));
}

export async function runBench(options: RunBenchOptions = {}): Promise<RunBenchResult> {
  const env = options.env ?? process.env;
  const tasks = selectTasks(await loadTasks(options.tasksDir ?? defaultTasksDir), options.filter);
  if (tasks.length === 0) throw new Error("no benchmark tasks selected");
  const pricing = pricingFromEnv(env);
  const generatedAt = new Date().toISOString();
  const runs: TaskRunResult[] = [];
  for (const task of tasks) {
    runs.push(await runTask(task, pricing));
  }
  const baseline: BaselineReport = options.skipBaseline
    ? { name: "codex", status: "skipped", reason: "disabled by --no-baseline", runs: [] }
    : await runBaseline(tasks, { env });
  const report = buildReport({ generatedAt, tasks: runs, pricing, baseline });
  const { reportPath, summaryPath } = await writeReport(
    report,
    options.outDir ?? defaultOutDir(generatedAt),
  );
  return { report, reportPath, summaryPath };
}
