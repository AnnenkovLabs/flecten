import { createSession, type SessionOptions } from "../core/session/session";
import type { Event } from "../core/types";
import { conversationBudget } from "./conversation-budget";

/** Single-role chats keep the same durable budget as Talker/Worker conversations. */
export function createSingleSession(options: SessionOptions, events: readonly Event[]) {
  const ledger = conversationBudget(options, events);
  const session = createSession({
    ...options,
    taskBudget: ledger,
    externalBudgetExhausted: () => ledger.stopReason(),
  });
  return {
    ...session,
    update(next: Partial<SessionOptions>) {
      if (next.budgets)
        ledger.setLimits({
          maxTokens: next.budgets.maxTokens,
          maxCostUsd: next.budgets.maxCostUsd,
        });
      session.update(next);
    },
  };
}
