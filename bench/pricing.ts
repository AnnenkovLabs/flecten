import type { Usage } from "../src/core/types";

export interface Pricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cachedUsdPerMTok: number;
  source: "default" | "env";
}

const INPUT = "BENCH_INPUT_USD_PER_MTOK";
const OUTPUT = "BENCH_OUTPUT_USD_PER_MTOK";
const CACHED = "BENCH_CACHED_USD_PER_MTOK";

const DEFAULTS = {
  inputUsdPerMTok: 0.15,
  outputUsdPerMTok: 0.6,
  cachedUsdPerMTok: 0.015,
};

function readPrice(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

function configured(env: Record<string, string | undefined>): boolean {
  return [INPUT, OUTPUT, CACHED].some((name) => {
    const raw = env[name];
    return raw !== undefined && raw.trim().length > 0;
  });
}

export function pricingFromEnv(env: Record<string, string | undefined>): Pricing {
  return {
    inputUsdPerMTok: readPrice(env, INPUT, DEFAULTS.inputUsdPerMTok),
    outputUsdPerMTok: readPrice(env, OUTPUT, DEFAULTS.outputUsdPerMTok),
    cachedUsdPerMTok: readPrice(env, CACHED, DEFAULTS.cachedUsdPerMTok),
    source: configured(env) ? "env" : "default",
  };
}

export function costOf(usage: Usage, pricing: Pricing): number {
  const cached = Math.min(usage.cached, usage.input);
  const input = Math.max(0, usage.input - cached);
  const cost =
    (input * pricing.inputUsdPerMTok +
      cached * pricing.cachedUsdPerMTok +
      usage.output * pricing.outputUsdPerMTok) /
    1_000_000;
  return Math.round(cost * 1e8) / 1e8;
}
