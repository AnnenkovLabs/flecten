import type { SerializedQueue } from "../queue/types";
import type { Event } from "../types";

/** Deltas are replaced by the finished message; structural positions remain on disk. */
const TRANSIENT: ReadonlySet<Event["type"]> = new Set([
  "message.delta",
  "reasoning.delta",
  "tool_call.progress",
  "provider.retry",
]);

export function isPersistentEvent(event: Event): boolean {
  if (event.type === "worker.event" || event.type === "subagent.event")
    return isPersistentEvent(event.event);
  return !TRANSIENT.has(event.type);
}

interface PersistenceOptions {
  onEvent?: ((event: Event) => void | Promise<void>) | undefined;
  saveQueue?: ((sessionId: string, queue: SerializedQueue) => Promise<void>) | undefined;
}

/** Queue removals cannot reach disk before the event which acknowledges their delivery. */
export class SessionPersistence {
  #events: Promise<void> = Promise.resolve();
  #queue: Promise<void> = Promise.resolve();
  #reported = false;

  constructor(
    private readonly options: PersistenceOptions,
    private readonly onError: (error: unknown) => void,
  ) {}

  event(event: Event): void {
    this.#events = this.#events.then(() => this.options.onEvent?.(event));
    this.watch(this.#events);
  }

  queue(sessionId: string, snapshot: SerializedQueue): Promise<void> {
    const delivered = this.#events;
    this.#queue = this.#queue
      .then(() => delivered)
      .then(() => this.options.saveQueue?.(sessionId, snapshot));
    this.watch(this.#queue);
    return this.#queue;
  }

  async flush(): Promise<void> {
    await Promise.all([this.#events, this.#queue]);
  }

  private watch(write: Promise<void>): void {
    void write.catch((error: unknown) => {
      if (this.#reported) return;
      this.#reported = true;
      this.onError(error);
    });
  }
}
