import type {
  SummaryInteraction,
  SummaryInteractionDelivery,
} from "../../shared/summary-interaction";
import type { ContextReference } from "../core/context-reference";
import { redactKnown } from "../util/redact";

type Capture = Extract<SummaryInteraction, { kind: "capture" }>;

interface Batch {
  delivery: SummaryInteractionDelivery;
  events: Capture[];
  timer?: ReturnType<typeof setTimeout>;
  elapsed: boolean;
  ready: boolean;
  delivered: boolean;
}

const MAX_SESSIONS = 32;
const MAX_SUMMARIES = 8;
const MAX_EVENTS = 6;
const MAX_DELIVERED_EVENTS = 12;

/** ponytail: pending interactions are process-local and bounded; use the session store if they need restart recovery. */
export class SummaryInteractions {
  readonly #sessions = new Map<string, Map<string, Batch>>();

  constructor(
    private readonly wake: () => void,
    private readonly secrets: () => readonly string[],
  ) {}

  receive(sessionId: string, summaryId: string, event: SummaryInteraction): void {
    let summaries = this.#sessions.get(sessionId);
    if (event.kind === "configure") {
      if (summaries?.has(summaryId)) return;
      if (!summaries) {
        if (this.#sessions.size === MAX_SESSIONS) {
          const oldest = this.#sessions.keys().next().value;
          if (oldest) this.clear(oldest);
        }
        summaries = new Map();
        this.#sessions.set(sessionId, summaries);
      }
      if (summaries.size === MAX_SUMMARIES) {
        const oldest = summaries.keys().next().value;
        if (oldest) {
          clearTimeout(summaries.get(oldest)?.timer);
          summaries.delete(oldest);
        }
      }
      const batch: Batch = {
        delivery: event.delivery,
        events: [],
        elapsed: false,
        ready: false,
        delivered: false,
      };
      summaries.set(summaryId, batch);
      if (batch.delivery.when === "after-delay") this.#arm(batch, batch.delivery.delayMs);
      return;
    }
    const batch = summaries?.get(summaryId);
    if (!batch || batch.delivered) return;
    if (event.kind === "trigger") {
      if (batch.delivery.when === "on-action") this.#ready(batch);
      return;
    }
    batch.events.push(redactKnown(event, this.secrets()));
    if (batch.events.length > MAX_EVENTS) batch.events.shift();
    if (batch.delivery.when === "after-first-interaction" && !batch.timer && !batch.elapsed) {
      this.#arm(batch, batch.delivery.delayMs);
    }
    if (batch.elapsed) this.#ready(batch);
  }

  pending(): string[] {
    return [...this.#sessions]
      .filter(([, summaries]) => [...summaries.values()].some((batch) => batch.ready))
      .map(([sessionId]) => sessionId);
  }

  take(sessionId: string, userMessage: boolean): ContextReference | undefined {
    const summaries = this.#sessions.get(sessionId);
    if (!summaries) return;
    const events: { summaryId: string; name: string; value: Capture["value"] }[] = [];
    for (const [summaryId, batch] of summaries) {
      const next = batch.delivery.when === "next-message";
      if ((next ? !userMessage : !batch.ready) || batch.events.length === 0) continue;
      for (const { name, value } of batch.events) events.push({ summaryId, name, value });
      batch.ready = false;
      batch.events = [];
      if (!next && batch.delivery.when !== "on-action") batch.delivered = true;
    }
    if (events.length === 0) return;
    return {
      kind: "summary-interaction",
      source: "HTML summary",
      label: "HTML summary interactions",
      text: events
        .slice(-MAX_DELIVERED_EVENTS)
        .map((event) => JSON.stringify(event))
        .join("\n"),
    };
  }

  clear(sessionId: string): void {
    const summaries = this.#sessions.get(sessionId);
    for (const batch of summaries?.values() ?? []) clearTimeout(batch.timer);
    this.#sessions.delete(sessionId);
  }

  cancelPending(sessionId: string): void {
    for (const batch of this.#sessions.get(sessionId)?.values() ?? []) {
      batch.events = [];
      batch.ready = false;
      if (batch.delivery.when === "after-first-interaction") {
        clearTimeout(batch.timer);
        delete batch.timer;
        batch.elapsed = false;
      }
    }
  }

  dispose(): void {
    for (const sessionId of this.#sessions.keys()) this.clear(sessionId);
  }

  #arm(batch: Batch, delayMs: number): void {
    batch.timer = setTimeout(() => {
      delete batch.timer;
      batch.elapsed = true;
      this.#ready(batch);
    }, delayMs);
    batch.timer.unref?.();
  }

  #ready(batch: Batch): void {
    if (batch.ready || batch.events.length === 0) return;
    batch.ready = true;
    this.wake();
  }
}
