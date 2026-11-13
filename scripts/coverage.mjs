#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const tests = ["tests/unit", "tests/integration", "tests/smoke.test.ts"];
const reportDirectory = resolve(root, "coverage");
const rawThreshold = process.argv[2] ?? process.env.COVERAGE_THRESHOLD ?? "85";
const threshold = Number(rawThreshold);

if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
  console.error(`coverage: threshold must be a number from 0 to 100, got "${rawThreshold}"`);
  process.exit(2);
}

function parseCoverageReport(output) {
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith("All files"));
  if (line === undefined) return undefined;
  const cells = line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  const functions = Number(cells[1]);
  const lines = Number(cells[2]);
  if (!Number.isFinite(functions) || !Number.isFinite(lines)) return undefined;
  return { functions, lines };
}

function tail(output, limit = 40) {
  return output.split(/\r?\n/).slice(-limit).join("\n");
}

const proc = Bun.spawn({
  cmd: [
    "bun",
    "test",
    ...tests,
    "--coverage",
    "--coverage-reporter=text",
    "--coverage-reporter=lcov",
    `--coverage-dir=${reportDirectory}`,
  ],
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);
const output = `${stdout}\n${stderr}`.trimEnd();
await mkdir(reportDirectory, { recursive: true });
await writeFile(resolve(reportDirectory, "coverage.txt"), `${output}\n`);
const totals = parseCoverageReport(output);

if (totals === undefined) {
  console.error(tail(output));
  console.error("coverage: could not find the Bun coverage total");
  process.exit(1);
}

console.log(
  `coverage: lines ${totals.lines.toFixed(2)}%, functions ${totals.functions.toFixed(2)}%, threshold ${threshold.toFixed(2)}%`,
);

if (exitCode !== 0) {
  console.error(tail(output));
  console.error(`coverage: test command failed with exit code ${exitCode}`);
  process.exit(exitCode);
}

if (totals.lines < threshold) {
  console.error(
    `coverage: below threshold (${totals.lines.toFixed(2)}% < ${threshold.toFixed(2)}%)`,
  );
  process.exit(1);
}

console.log("coverage: pass");
