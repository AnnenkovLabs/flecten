import type { BudgetAmounts, BudgetKind, BudgetView, Usage } from "../types";

/** Abort reason of a run stopped by its wall-clock limit. */
export const BUDGET_ABORT = "budget";

export interface BudgetLimits {
  maxTokens?: number | undefined;
  maxCostUsd?: number | undefined;
  maxWallClockMs?: number | undefined;
}

/** Price of a usage in USD, or undefined when the model has no price. */
export type UsagePrice = (usage: Usage) => number | undefined;

const LABELS: Record<BudgetKind, string> = {
  tokens: "лимит токенов",
  cost: "лимит стоимости",
  wall_clock: "лимит времени",
};

/**
 * Token, cost and wall-clock limits of one run. The loop asks `exhausted()` before every
 * model request, so a run never starts a request past its limit; the wall clock aborts the
 * run when it expires, even in the middle of a long tool call.
 */
export class RunBudget {
  readonly #limits: BudgetLimits;
  readonly #price: UsagePrice | undefined;
  readonly #now: () => number;
  readonly #started: number;
  #usage: Usage = { input: 0, output: 0, cached: 0 };
  #costUsd: number | undefined;
  #costComplete = true;
  #exceeded: BudgetKind | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(limits: BudgetLimits, price?: UsagePrice, now: () => number = Date.now) {
    this.#limits = limits;
    this.#price = price;
    this.#now = now;
    this.#started = now();
  }

  /** Aborts through `onExpire` when the wall-clock limit passes; returns the cleanup. */
  arm(onExpire: () => void): () => void {
    const limit = this.#limits.maxWallClockMs;
    if (limit === undefined) return () => undefined;
    this.#timer = setTimeout(() => {
      this.#exceeded ??= "wall_clock";
      onExpire();
    }, limit);
    return () => {
      if (this.#timer !== undefined) clearTimeout(this.#timer);
      this.#timer = undefined;
    };
  }

  add(usage: Usage, price: UsagePrice | undefined = this.#price): BudgetView {
    const cost = price?.(usage);
    if (cost === undefined && usage.input + usage.output > 0) this.#costComplete = false;
    if (cost !== undefined) this.#costUsd = (this.#costUsd ?? 0) + cost;
    this.#usage = {
      input: this.#usage.input + usage.input,
      output: this.#usage.output + usage.output,
      cached: this.#usage.cached + usage.cached,
    };
    return this.view();
  }

  /** The limit that is used up, checked before the next model request. */
  exhausted(): BudgetKind | undefined {
    if (this.#exceeded) return this.#exceeded;
    const view = this.view();
    const { limits, spent } = view;
    if (limits.tokens !== undefined && spent.tokens >= limits.tokens) this.#exceeded = "tokens";
    else if (
      limits.costUsd !== undefined &&
      spent.costUsd !== undefined &&
      spent.costUsd >= limits.costUsd
    )
      this.#exceeded = "cost";
    else if (limits.wallClockMs !== undefined && spent.wallClockMs >= limits.wallClockMs)
      this.#exceeded = "wall_clock";
    return this.#exceeded;
  }

  /** Text for the run summary when a limit stopped it. */
  reason(kind: BudgetKind): string {
    const view = this.view();
    return `Прогон остановлен: исчерпан ${LABELS[kind]} (${describe(kind, view)}).`;
  }

  stopReason(): string | undefined {
    const kind = this.exhausted();
    return kind ? this.reason(kind) : undefined;
  }

  hasLimits(): boolean {
    const limits = this.#limits;
    return (
      limits.maxTokens !== undefined ||
      limits.maxCostUsd !== undefined ||
      limits.maxWallClockMs !== undefined
    );
  }

  view(): BudgetView {
    const tokens = this.#usage.input + this.#usage.output;
    const costUsd = this.#costComplete
      ? (this.#costUsd ?? this.#price?.({ input: 0, output: 0, cached: 0 }))
      : undefined;
    const wallClockMs = Math.max(0, this.#now() - this.#started);
    const limits: BudgetAmounts = {
      ...(this.#limits.maxTokens === undefined ? {} : { tokens: this.#limits.maxTokens }),
      ...(this.#limits.maxCostUsd === undefined ? {} : { costUsd: this.#limits.maxCostUsd }),
      ...(this.#limits.maxWallClockMs === undefined
        ? {}
        : { wallClockMs: this.#limits.maxWallClockMs }),
    };
    const remaining: BudgetAmounts = {
      ...(limits.tokens === undefined ? {} : { tokens: Math.max(0, limits.tokens - tokens) }),
      ...(limits.costUsd === undefined || costUsd === undefined
        ? {}
        : { costUsd: Math.max(0, limits.costUsd - costUsd) }),
      ...(limits.wallClockMs === undefined
        ? {}
        : { wallClockMs: Math.max(0, limits.wallClockMs - wallClockMs) }),
    };
    return {
      limits,
      spent: { tokens, ...(costUsd === undefined ? {} : { costUsd }), wallClockMs },
      remaining,
      ...(this.#exceeded ? { exceeded: this.#exceeded } : {}),
    };
  }
}

function describe(kind: BudgetKind, view: BudgetView): string {
  if (kind === "tokens") return `${view.spent.tokens} из ${view.limits.tokens ?? 0} токенов`;
  if (kind === "cost") {
    return `$${(view.spent.costUsd ?? 0).toFixed(2)} из $${(view.limits.costUsd ?? 0).toFixed(2)}`;
  }
  const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} мин`;
  return `${minutes(view.spent.wallClockMs)} из ${minutes(view.limits.wallClockMs ?? 0)}`;
}
