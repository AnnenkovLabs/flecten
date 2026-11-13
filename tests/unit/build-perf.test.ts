import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_SIZE_BUDGET_BYTES, checkAgentSize } from "../../scripts/build-agent";

const require = createRequire(import.meta.url);
const { checkArtifactSize, INSTALLER_BUDGET_BYTES } =
  require("../../scripts/artifact-budget.mjs") as {
    checkArtifactSize(name: string, bytes: number): void;
    INSTALLER_BUDGET_BYTES: number;
  };

test("release installer budget rejects oversized packages before publishing checksums", () => {
  for (const name of ["Flecten.AppImage", "Flecten.dmg", "Flecten.zip", "Flecten.exe"]) {
    expect(() => checkArtifactSize(name, INSTALLER_BUDGET_BYTES)).not.toThrow();
    expect(() => checkArtifactSize(name, INSTALLER_BUDGET_BYTES + 1)).toThrow("installer budget");
  }
  expect(() => checkArtifactSize("sbom.json", INSTALLER_BUDGET_BYTES + 1)).not.toThrow();
});

interface StartupSummary {
  p50Ms: number;
  p95Ms: number;
  budgetMs: number;
  ok: boolean;
}

interface StartupResult extends StartupSummary {
  samples: number[];
}

const startup = require("../../scripts/measure-startup.mjs") as {
  measureStartup: (
    binary: string,
    options?: { iterations?: number; budgetMs?: number; args?: string[] },
  ) => Promise<StartupResult>;
  summarizeStartup: (samples: number[], budgetMs?: number) => StartupSummary;
  formatStartupReport: (samples: number[], budgetMs?: number) => string;
  parseStartupReport: (text: string) => StartupSummary;
};

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("agent size budget", () => {
  test("accepts a binary at the budget", () => {
    const check = checkAgentSize(AGENT_SIZE_BUDGET_BYTES);
    expect(check.ok).toBe(true);
    expect(check.message).toContain("within the 85.0 MiB budget");
  });

  test("rejects a binary over the budget with a clear message", () => {
    const check = checkAgentSize(AGENT_SIZE_BUDGET_BYTES + 1);
    expect(check.ok).toBe(false);
    expect(check.message).toContain("over the 85.0 MiB budget");
    expect(check.message).toContain("Remove build inputs");
  });
});

describe("startup measurement output", () => {
  test("round-trips the formatted report", () => {
    const report = startup.formatStartupReport([900, 700, 610], 1_000);
    expect(report).toContain("startup run 1: 900ms");
    expect(startup.parseStartupReport(report)).toEqual({
      p50Ms: 700,
      p95Ms: 900,
      budgetMs: 1_000,
      ok: true,
    });
  });

  test("reports a p95 budget miss", () => {
    const report = startup.formatStartupReport([500, 700, 900], 800);
    expect(report).toContain("status=fail");
    expect(startup.parseStartupReport(report).ok).toBe(false);
    expect(startup.summarizeStartup([500, 700, 900], 800)).toEqual({
      p50Ms: 700,
      p95Ms: 900,
      budgetMs: 800,
      ok: false,
    });
  });

  test("rejects output without a summary", () => {
    expect(() => startup.parseStartupReport("startup run 1: 900ms")).toThrow(
      "cold start summary line missing",
    );
    expect(() =>
      startup.parseStartupReport("cold start p50=1ms p95=nope budget=2ms status=ok"),
    ).toThrow("invalid p95");
  });
});

describe("startup measurement", () => {
  test("measures a fake sidecar and enforces the budget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "liquid-startup-fake-"));
    dirs.push(dir);
    const fake = join(dir, "fake-sidecar.mjs");
    writeFileSync(fake, 'setTimeout(() => process.stdout.write(\'{"type":"status"}\\n\'), 25);\n');

    const result = await startup.measureStartup(process.execPath, {
      args: [fake],
      iterations: 2,
      budgetMs: 60_000,
    });

    expect(result.samples).toHaveLength(2);
    for (const ms of result.samples) expect(ms).toBeGreaterThanOrEqual(20);
    expect(result.ok).toBe(true);
    expect(startup.summarizeStartup(result.samples, 1).ok).toBe(false);
  });
});
