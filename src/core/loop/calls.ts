/** Abort reason of a tool call the user cancelled from its card. */
export const CALL_CANCELLED = "cancelled";

export interface CallScope {
  readonly signal: AbortSignal;
  readonly cancelled: () => boolean;
  close(): void;
}

/**
 * Running tool calls by id. Each call gets its own signal under the run signal, so the user
 * can cancel one long call (and its process tree) without stopping the whole run.
 */
export class ToolCalls {
  readonly #running = new Map<string, AbortController>();

  open(callId: string, parent: AbortSignal): CallScope {
    const controller = new AbortController();
    const forward = () => controller.abort(parent.reason);
    if (parent.aborted) forward();
    else parent.addEventListener("abort", forward, { once: true });
    this.#running.set(callId, controller);
    return {
      signal: controller.signal,
      cancelled: () => controller.signal.reason === CALL_CANCELLED,
      close: () => {
        parent.removeEventListener("abort", forward);
        if (this.#running.get(callId) === controller) this.#running.delete(callId);
      },
    };
  }

  cancel(callId: string): boolean {
    const controller = this.#running.get(callId);
    if (!controller || controller.signal.aborted) return false;
    controller.abort(CALL_CANCELLED);
    return true;
  }

  running(): string[] {
    return [...this.#running.keys()];
  }

  abortAll(reason: unknown): void {
    for (const controller of this.#running.values()) controller.abort(reason);
  }
}
