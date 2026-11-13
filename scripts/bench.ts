import { parseArgs } from "node:util";
import { runBench } from "../bench/run";

const { values } = parseArgs({
  options: {
    filter: { type: "string" },
    out: { type: "string" },
    tasks: { type: "string" },
    "no-baseline": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: false,
});

if (values.help === true) {
  console.log(
    [
      "Usage: bun scripts/bench.ts [options]",
      "",
      "  --filter a,b   run only the listed task ids",
      "  --out path     write report.json and summary.md to path",
      "  --tasks path   load tasks from another directory",
      "  --no-baseline  skip the Codex baseline adapter",
      "",
      "The Codex baseline runs only when BENCH_CODEX_CLI=1 is set.",
    ].join("\n"),
  );
  process.exit(0);
}

const filter =
  values.filter === undefined
    ? undefined
    : values.filter
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

const result = await runBench({
  ...(filter === undefined ? {} : { filter }),
  ...(values.out === undefined ? {} : { outDir: values.out }),
  ...(values.tasks === undefined ? {} : { tasksDir: values.tasks }),
  skipBaseline: values["no-baseline"] === true,
});

console.log(
  `tasks ${result.report.summary.passed}/${result.report.summary.total} passed, ${result.report.summary.failed} failed in ${Math.round(result.report.summary.durationMs)} ms`,
);
console.log(
  result.report.baseline.status === "skipped"
    ? `baseline skipped: ${result.report.baseline.reason ?? "unavailable"}`
    : `baseline ran: ${result.report.baseline.runs.length} task(s)`,
);
console.log(`report ${result.reportPath}`);
console.log(`summary ${result.summaryPath}`);
process.exitCode = result.report.summary.failed > 0 ? 1 : 0;
