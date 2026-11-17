import type { LoopEvent } from "../loop/types";
import type { Event } from "../types";
import { addUsage } from "../types/message";
import type { RunBudget } from "./budget";
import type { SessionCompaction } from "./compaction";
import { mapLoopEvent } from "./loop-events";
import type { SessionOptions } from "./options";
import type { ActiveRun } from "./runtime";

/** Budget events follow the ledger mutation; usage events precede it. */
export function accountingChanged(event: Event): boolean {
  if (event.type === "worker.event" || event.type === "subagent.event")
    return accountingChanged(event.event);
  return event.type === "budget" || event.type === "task.budget";
}

export function taskBudgetEvent(sessionId: string, budget: RunBudget): Event {
  return { type: "task.budget", sessionId, budget: budget.view() };
}

/** Main and summary requests share one accounting boundary, including failed requests. */
export function runAccounting(
  options: SessionOptions,
  state: ActiveRun,
  compaction: SessionCompaction,
  emit: (event: Event) => void,
): (event: LoopEvent) => void {
  return (event) => {
    if (event.type === "turn.started") state.turns = event.turn;
    compaction.note(state.sessionId, event);
    emit(
      mapLoopEvent(
        event.type === "usage" && event.provider === undefined
          ? { ...event, provider: options.providerId }
          : event,
        state.sessionId,
      ),
    );
    if (event.type === "usage") {
      state.usage = addUsage(state.usage, event.usage);
      const provider = event.provider ?? options.providerId;
      const model = event.model ?? options.model;
      const price =
        options.priceFor?.(provider, model) ??
        (provider === options.providerId && model === options.model
          ? options.price
          : () => undefined);
      emit({
        type: "budget",
        sessionId: state.sessionId,
        budget: state.budget.add(event.usage, price),
      });
    } else if (event.type === "usage.unavailable") {
      emit({ type: "budget", sessionId: state.sessionId, budget: state.budget.unavailable() });
    }
  };
}
