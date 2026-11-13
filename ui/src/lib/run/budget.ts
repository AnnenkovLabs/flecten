// The run budget as short meters: spent against the limit for tokens, money and time.
import { formatTokens } from "../format";
import { t } from "../i18n.svelte";
import type { AgentBudget } from "../types";

export interface BudgetMeter {
  kind: "tokens" | "cost" | "wall_clock";
  label: string;
  /** Spent share of the limit, 0..1. */
  ratio: number;
}

function minutes(ms: number): string {
  const value = ms / 60_000;
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

function share(spent: number, limit: number): number {
  return limit > 0 ? Math.min(1, Math.max(0, spent / limit)) : 0;
}

/** Only limits that are set, in the order tokens, cost, time. */
export function budgetMeters(budget: AgentBudget): BudgetMeter[] {
  const { limits, spent } = budget;
  const meters: BudgetMeter[] = [];
  if (limits.tokens) {
    meters.push({
      kind: "tokens",
      label: t("{0} of {1} tokens", [formatTokens(spent.tokens), formatTokens(limits.tokens)]),
      ratio: share(spent.tokens, limits.tokens),
    });
  }
  if (limits.costUsd) {
    const cost = spent.costUsd ?? 0;
    meters.push({
      kind: "cost",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: This dictionary key uses numbered placeholders.
      label: t("${0} of ${1}", [cost.toFixed(2), limits.costUsd.toFixed(2)]),
      ratio: share(cost, limits.costUsd),
    });
  }
  if (limits.wallClockMs) {
    meters.push({
      kind: "wall_clock",
      label: t("{0} of {1} min", [minutes(spent.wallClockMs), minutes(limits.wallClockMs)]),
      ratio: share(spent.wallClockMs, limits.wallClockMs),
    });
  }
  return meters;
}

/** Calm under 80 %, a warning near the limit, red once a limit stopped the run. */
export function budgetTone(
  budget: AgentBudget,
  meters: readonly BudgetMeter[],
): "ok" | "warn" | "over" {
  if (budget.exceeded) return "over";
  return meters.some((meter) => meter.ratio >= 0.8) ? "warn" : "ok";
}
