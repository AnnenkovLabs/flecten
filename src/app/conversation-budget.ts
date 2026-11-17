import { z } from "zod";
import { RunBudget } from "../core/session/budget";
import type { SessionOptions } from "../core/session/options";
import type { Event } from "../core/types";
import { accountTwinUsage } from "./twin-accounting";

const nonnegative = z.number().finite().nonnegative();
const amounts = z.object({
  tokens: nonnegative.optional(),
  costUsd: nonnegative.optional(),
  wallClockMs: nonnegative.optional(),
});
const snapshot = z.object({
  limits: amounts,
  spent: z.object({
    tokens: nonnegative,
    costUsd: nonnegative.optional(),
    wallClockMs: nonnegative,
  }),
  remaining: amounts,
  exceeded: z.enum(["tokens", "cost", "wall_clock"]).optional(),
  accounting: z
    .object({
      status: z.enum(["reported", "unavailable"]),
      missingRequests: nonnegative.int(),
      unpricedRequests: nonnegative.int(),
      knownCostUsd: nonnegative.optional(),
    })
    .optional(),
});

/** One durable ledger per chat. Local run timers remain independent. */
export function conversationBudget(
  options: Pick<SessionOptions, "budgets" | "providerId" | "model" | "price" | "priceFor">,
  events: readonly Event[],
): RunBudget {
  const ledger = new RunBudget({
    ...(options.budgets?.maxTokens === undefined ? {} : { maxTokens: options.budgets.maxTokens }),
    ...(options.budgets?.maxCostUsd === undefined
      ? {}
      : { maxCostUsd: options.budgets.maxCostUsd }),
  });
  const latest = events.findLastIndex((event) => event.type === "task.budget");
  const prior = latest >= 0 ? events[latest] : undefined;
  if (prior?.type === "task.budget")
    ledger.restore(snapshot.parse(prior.budget) as import("../core/types").BudgetView);
  // Reconcile events after the last checkpoint, including a crash between usage and budget.
  const prices = new Map<string, { provider: string; model: string }>();
  const replay = (event: Event): void => {
    if (event.type === "worker.event" || event.type === "subagent.event") {
      replay(event.event);
      return;
    }
    if (event.type === "session.started" || event.type === "model.fallback")
      prices.set(event.sessionId, { provider: event.provider, model: event.model });
    if (event.type === "usage") {
      const route = prices.get(event.sessionId);
      const provider = event.provider ?? route?.provider ?? options.providerId;
      const model = event.model ?? route?.model ?? options.model;
      const price =
        options.priceFor?.(provider, model) ??
        (provider === options.providerId && model === options.model
          ? options.price
          : () => undefined);
      ledger.add(event.usage, price);
    }
    if (event.type === "usage.unavailable") ledger.unavailable();
    if (event.type === "twin.activity" && event.activity.usage) {
      accountTwinUsage(ledger, event.activity.usage);
    }
  };
  const rememberRoute = (event: Event): void => {
    if (event.type === "worker.event" || event.type === "subagent.event")
      rememberRoute(event.event);
    else if (event.type === "session.started" || event.type === "model.fallback")
      prices.set(event.sessionId, { provider: event.provider, model: event.model });
  };
  for (const event of events.slice(0, latest + 1)) rememberRoute(event);
  for (const event of events.slice(latest + 1)) replay(event);
  return ledger;
}
