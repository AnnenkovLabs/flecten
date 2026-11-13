import type { AgentEvent, ContextSource, ContextUsage } from "./agent-protocol";
import { t } from "./i18n.svelte";
import type { TokenUsageDetails } from "./run/token-usage";

export type ContextLevel = "ok" | "warn" | "high" | "critical";

export const CONTEXT_THRESHOLDS = [70, 85, 95] as const;

export interface ContextView {
  usage?: TokenUsageDetails;
  used: number;
  window: number;
  reserve: number;
  source: ContextSource | "none";
  percent: number;
  level: ContextLevel;
  /** Percent at which the core compacts on its own. */
  autoAt: number;
}

export function contextLevel(percent: number): ContextLevel {
  if (percent >= 95) return "critical";
  if (percent >= 85) return "high";
  if (percent >= 70) return "warn";
  return "ok";
}

export function shortTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}k`;
  return String(Math.max(0, Math.round(value)));
}

/** Highest threshold crossed upward between two readings, if any. */
export function crossedThreshold(previous: number, next: number): number | undefined {
  let crossed: number | undefined;
  for (const threshold of CONTEXT_THRESHOLDS) {
    if (previous < threshold && next >= threshold) crossed = threshold;
  }
  return crossed;
}

function availableContext(window: number, reserve: number): number {
  return Math.max(0, window - reserve);
}

/**
 * The meter shows how full the next request will be. The core sends an estimate before every
 * request and the provider count after it; whichever came last wins. Capacity excludes the
 * reply reserve, so 100% means automatic compaction. Billing totals never land here.
 */
export class ContextMeter {
  used = $state(0);
  window = $state(0);
  reserve = $state(0);
  source = $state<ContextSource | "none">("none");
  #warned = new Set<number>();

  view(fallbackWindow: number): ContextView {
    const window = availableContext(this.window > 0 ? this.window : fallbackWindow, this.reserve);
    const percent = window > 0 ? Math.min(100, Math.round((this.used / window) * 100)) : 0;
    return {
      used: this.used,
      window,
      reserve: this.reserve,
      source: this.source,
      percent,
      level: contextLevel(percent),
      autoAt: 100,
    };
  }

  /** Returns the threshold to warn about when this reading crosses one for the first time. */
  apply(next: ContextUsage): number | undefined {
    const window = next.window > 0 ? next.window : this.window;
    const available = availableContext(window, next.reserve);
    const before = available > 0 ? (this.used / available) * 100 : 0;
    const after = available > 0 ? (next.used / available) * 100 : 0;
    this.used = Math.max(0, next.used);
    this.window = window;
    this.reserve = next.reserve;
    this.source = next.source;
    const crossed = crossedThreshold(before, after);
    if (crossed === undefined || this.#warned.has(crossed)) return undefined;
    this.#warned.add(crossed);
    return crossed;
  }

  reset(): void {
    this.used = 0;
    this.source = "none";
    this.#warned = new Set();
  }

  compacted(): void {
    this.#warned = new Set();
  }
}

export function contextWarning(threshold: number): string {
  if (threshold >= 95)
    return t(
      "Context is almost full (95%). Compress it now, or the core will compress it automatically.",
    );
  if (threshold >= 85)
    return t("Context is 85% full. You can compress it now, focusing on the topic you need.");
  return t("Context is 70% full. No need to compress it yet, but keep it in mind.");
}

/** One line under the "context compacted" note: page number, size change, focus. */
export function compactionMeta(event: Extract<AgentEvent, { type: "context.compacted" }>): string {
  const parts: string[] = [];
  if (event.page !== undefined) parts.push(t("page {0}", [event.page]));
  if (event.before !== undefined && event.after !== undefined) {
    parts.push(t("{0} → {1} tokens", [shortTokens(event.before), shortTokens(event.after)]));
  }
  if (event.source === "deterministic") parts.push(t("no model"));
  if (event.focus) parts.push(t("focus: {0}", [event.focus]));
  return parts.length > 0 ? parts.join(" · ") : t("{0} older outputs compressed", [event.pruned]);
}
