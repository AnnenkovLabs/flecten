import { createSession, type SessionOptions } from "../core/session/session";
import type { Event } from "../core/types";
import { conversationBudget } from "./conversation-budget";
import { SessionTwinDriver, type TwinRuntime } from "./session-twin";

/** Single-role chats keep the same durable budget and Twin clone driver as Talker/Worker conversations. */
export function createSingleSession(
  options: SessionOptions & { twin?: TwinRuntime },
  events: readonly Event[],
) {
  const ledger = conversationBudget(options, events);
  const listeners = new Set<(event: Event) => void>();
  const publish = (event: Event) => {
    for (const listener of listeners) listener(event);
  };
  let twinDriver: SessionTwinDriver | undefined;
  const session = createSession({
    ...options,
    taskBudget: ledger,
    externalBudgetExhausted: () => ledger.stopReason(),
  });
  twinDriver = new SessionTwinDriver(
    {
      ...(options.twin ? { twin: options.twin } : {}),
      sessionId: () => session.getSessionId() ?? options.sessionId ?? "default",
      ledger,
      // Twin activity is app-owned, so it is persisted here; core events persist themselves.
      emit: (event) => {
        void options.onEvent?.(event);
        publish(event);
      },
      sendToChat: (command) => session.send(command),
    },
    events,
  );
  session.subscribe((event) => {
    twinDriver?.note(event);
    publish(event);
  });
  return {
    ...session,
    subscribe(listener: (event: Event) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(next: Partial<SessionOptions>) {
      if (next.budgets)
        ledger.setLimits({
          maxTokens: next.budgets.maxTokens,
          maxCostUsd: next.budgets.maxCostUsd,
        });
      session.update(next);
    },
    async dispose() {
      twinDriver?.dispose();
      await session.dispose();
    },
  };
}
