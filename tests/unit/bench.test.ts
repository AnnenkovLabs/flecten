import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runBaseline } from "../../bench/baseline";
import { evaluateChecks } from "../../bench/checks";
import { pricingFromEnv } from "../../bench/pricing";
import { runBench } from "../../bench/run";
import { loadTasks, TASK_GROUPS } from "../../bench/schema";

describe("benchmark suite", () => {
  test("baseline does not score file state that depends on an unavailable restore", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-bench-unobserved-"));
    try {
      await writeFile(join(cwd, "value.txt"), "changed");
      const checks = await evaluateChecks(
        [
          { type: "file_equals", path: "value.txt", content: "changed" },
          { type: "checkpoint_restore", target: "before" },
          { type: "file_equals", path: "value.txt", content: "original" },
        ],
        cwd,
      );
      expect(checks.map((entry) => entry.ok)).toEqual([true, null, null]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
  test("contains 20 tasks covering every harness group", async () => {
    const tasks = await loadTasks();
    expect(tasks).toHaveLength(20);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(20);
    const groups = new Set(tasks.map((task) => task.group));
    for (const group of TASK_GROUPS) expect(groups.has(group)).toBe(true);
    for (const task of tasks) {
      expect(task.checks.length).toBeGreaterThan(0);
      expect(task.script.length).toBeGreaterThan(0);
      expect(task.budgetTokens).toBeGreaterThan(0);
      expect(task.baseline).toBe("codex");
    }
  });

  test("runs a tiny fixture subset offline and writes both reports", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "liquid-bench-report-"));
    try {
      const result = await runBench({
        filter: ["read-config", "edit-version"],
        outDir,
        env: {},
      });

      expect(result.report.tasks.map((task) => task.status)).toEqual(["passed", "passed"]);
      expect(result.report.summary).toMatchObject({ total: 2, passed: 2, failed: 0, errors: 0 });
      expect(result.report.summary.usage.input).toBeGreaterThan(0);
      expect(result.report.summary.usage.output).toBeGreaterThan(0);
      expect(result.report.summary.costUsd).toBeGreaterThanOrEqual(0);
      expect(result.report.baseline.status).toBe("skipped");
      expect(result.report.baseline.runs).toEqual([]);
      expect(result.report.suiteHash).toMatch(/^[0-9a-f]{64}$/);
      for (const task of result.report.tasks) {
        expect(task.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(task.checksPassed).toBe(task.checksTotal);
        expect(task.scriptExhausted).toBe(false);
      }

      const json = JSON.parse(await readFile(result.reportPath, "utf8")) as {
        schemaVersion: number;
        environment: { bun: string };
        pricing: { source: string };
      };
      expect(json.schemaVersion).toBe(1);
      expect(json.environment.bun).toBe(Bun.version);
      expect(json.pricing.source).toBe("default");

      const summary = await readFile(result.summaryPath, "utf8");
      expect(summary).toContain("# Benchmark summary");
      expect(summary).toContain("| read | 1 | 1 |");
      expect(summary).toContain("| edit | 1 | 1 |");
      expect(summary).toContain("Codex baseline: skipped (BENCH_CODEX_CLI is not set)");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("reports the Codex baseline as skipped unless the explicit flag is set", async () => {
    const tasks = (await loadTasks()).slice(0, 1);
    const disabled = await runBaseline(tasks, { env: {} });
    expect(disabled).toEqual({
      name: "codex",
      status: "skipped",
      reason: "BENCH_CODEX_CLI is not set",
      runs: [],
    });

    const missing = await runBaseline(tasks, {
      env: {
        BENCH_CODEX_CLI: "1",
        BENCH_CODEX_BIN: "liquid-bench-codex-does-not-exist",
      },
    });
    expect(missing.status).toBe("skipped");
    expect(missing.runs).toEqual([]);
    expect(missing.reason).toContain("Codex CLI not found");
  });

  test("compaction summaries do not consume the scripted worker turns", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "liquid-bench-compact-"));
    try {
      const { report } = await runBench({
        filter: ["compact-prune", "compact-request-summary", "compact-summary"],
        outDir,
        env: {},
      });
      expect(report.summary).toMatchObject({ total: 3, passed: 3, failed: 0, errors: 0 });
      for (const task of report.tasks) {
        expect(task.scriptExhausted).toBe(false);
        expect(task.checksPassed).toBe(task.checksTotal);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("runs the baseline when the flag and a CLI binary are available", async () => {
    const tasks = await loadTasks();
    const task = tasks.find((entry) => entry.id === "bash-writes-file");
    if (task === undefined) throw new Error("bash-writes-file task is missing");
    const dir = await mkdtemp(join(tmpdir(), "liquid-bench-codex-"));
    try {
      const bin = join(dir, process.platform === "win32" ? "codex.exe" : "codex");
      await Bun.build({
        entrypoints: [resolve(import.meta.dir, "../helpers/bench-cli.ts")],
        compile: { outfile: bin },
      });
      const result = await runBaseline([task], {
        env: { BENCH_CODEX_CLI: "1", BENCH_CODEX_BIN: bin },
      });
      expect(result.status).toBe("ran");
      expect(result.runs).toHaveLength(1);
      expect(result.runs[0]).toMatchObject({
        id: "bash-writes-file",
        status: "passed",
        checksPassed: 1,
        checksTotal: 1,
        exitCode: 0,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects invalid pricing and unknown task ids", async () => {
    expect(() => pricingFromEnv({ BENCH_INPUT_USD_PER_MTOK: "free" })).toThrow(
      "BENCH_INPUT_USD_PER_MTOK",
    );
    await expect(runBench({ filter: ["not-a-task"], env: {} })).rejects.toThrow(
      "unknown benchmark task ids: not-a-task",
    );
  });
});
