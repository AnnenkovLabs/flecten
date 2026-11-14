import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ITERATIONS = 5;
// Generous: idle p95 is under 1s, a loaded build machine measured 3.6s. 8s catches real regressions.
export const P95_BUDGET_MS = 8_000;
const RUN_TIMEOUT_MS = 20_000;

export function summarizeStartup(samples, budgetMs = P95_BUDGET_MS) {
  if (samples.length === 0) {
    throw new Error("startup measurement has no samples");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (percent) => sorted[Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)];
  const p50Ms = at(50);
  const p95Ms = at(95);
  return { p50Ms, p95Ms, budgetMs, ok: p95Ms <= budgetMs };
}

export function formatStartupReport(samples, budgetMs = P95_BUDGET_MS) {
  const summary = summarizeStartup(samples, budgetMs);
  const runs = samples.map((ms, index) => `startup run ${index + 1}: ${ms}ms`);
  const status = summary.ok ? "ok" : "fail";
  return [
    ...runs,
    `cold start p50=${summary.p50Ms}ms p95=${summary.p95Ms}ms budget=${summary.budgetMs}ms status=${status}`,
  ].join("\n");
}

function readNumber(token, key) {
  const prefix = `${key}=`;
  if (!token.startsWith(prefix)) {
    throw new Error(`cold start summary is missing ${key}`);
  }
  const raw = token.slice(prefix.length);
  if (!raw.endsWith("ms")) {
    throw new Error(`cold start summary has an invalid ${key}`);
  }
  const digits = raw.slice(0, -2);
  const value = Number.parseInt(digits, 10);
  if (!Number.isInteger(value) || value < 0 || String(value) !== digits) {
    throw new Error(`cold start summary has an invalid ${key}`);
  }
  return value;
}

export function parseStartupReport(text) {
  const line = text.split("\n").find((candidate) => candidate.startsWith("cold start "));
  if (!line) {
    throw new Error("cold start summary line missing from measurement output");
  }
  const tokens = line.split(" ").slice(2);
  if (tokens.length !== 4) {
    throw new Error("cold start summary line is incomplete");
  }
  const [p50, p95, budget, status] = tokens;
  const ok = status === "status=ok" ? true : status === "status=fail" ? false : undefined;
  if (ok === undefined) {
    throw new Error("cold start summary has an invalid status");
  }
  return {
    p50Ms: readNumber(p50, "p50"),
    p95Ms: readNumber(p95, "p95"),
    budgetMs: readNumber(budget, "budget"),
    ok,
  };
}

function measureOnce(binary, args, cwd) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(binary, args, {
      cwd,
      env: { ...process.env, FLECTEN_CWD: cwd },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let settled = false;
    let outcome;
    const timer = setTimeout(() => {
      finish(new Error(`no status within ${RUN_TIMEOUT_MS}ms${err ? `: ${err}` : ""}`));
    }, RUN_TIMEOUT_MS);

    function finish(error, ms) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome = { error, ms };
      child.kill("SIGKILL");
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
      while (true) {
        const newline = out.indexOf("\n");
        if (newline < 0) break;
        const line = out.slice(0, newline);
        out = out.slice(newline + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message && message.type === "status") {
          finish(undefined, Math.round(performance.now() - started));
          return;
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      err = (err + chunk).slice(-2000);
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      finish(new Error(`sidecar exited (${code}) before status${err ? `: ${err.trim()}` : ""}`));
    });
    child.on("close", () => {
      if (outcome?.error) reject(outcome.error);
      else resolve(outcome?.ms);
    });
  });
}

export async function measureStartup(
  binary,
  { iterations = ITERATIONS, budgetMs = P95_BUDGET_MS, args = [] } = {},
) {
  try {
    await access(binary, constants.X_OK);
  } catch {
    throw new Error(`${binary} is not runnable. Run bun run build:agent first.`);
  }
  const cwd = await mkdtemp(join(tmpdir(), "liquid-startup-"));
  try {
    const samples = [];
    for (let run = 0; run < iterations; run += 1) {
      samples.push(await measureOnce(binary, args, cwd));
    }
    return { samples, ...summarizeStartup(samples, budgetMs) };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const binary = fileURLToPath(new URL("../dist/flecten-agent", import.meta.url));
  try {
    const result = await measureStartup(binary);
    console.log(formatStartupReport(result.samples, result.budgetMs));
    if (!result.ok) {
      console.error(
        `cold start p95 ${result.p95Ms}ms exceeds the ${result.budgetMs}ms budget. Investigate startup work or justify raising P95_BUDGET_MS in scripts/measure-startup.mjs.`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
