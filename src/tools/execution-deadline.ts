import type { ToolContext } from "./types";

/** Human approval time is separate from execution time, including through nested gateways. */
export class ToolExecutionDeadline {
  readonly #controller = new AbortController();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #started = performance.now();
  #remaining: number;
  #paused = 0;
  #closed = false;
  readonly #forward = () => this.#abort(this.parent.reason);

  constructor(
    private readonly parent: AbortSignal,
    milliseconds: number,
  ) {
    this.#remaining = milliseconds;
    if (parent.aborted) this.#forward();
    else {
      parent.addEventListener("abort", this.#forward, { once: true });
      this.#schedule();
    }
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  #abort(reason: unknown): void {
    clearTimeout(this.#timer);
    this.#controller.abort(reason);
  }

  #schedule(): void {
    if (this.#closed || this.signal.aborted) return;
    this.#started = performance.now();
    this.#timer = setTimeout(
      () => this.#abort(new Error("tool timed out")),
      Math.max(0, this.#remaining),
    );
  }

  #pause(): () => void {
    if (this.#paused++ === 0) {
      clearTimeout(this.#timer);
      this.#remaining -= performance.now() - this.#started;
      if (this.#remaining <= 0) this.#abort(new Error("tool timed out"));
    }
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      if (--this.#paused === 0) this.#schedule();
    };
  }

  scope(context: ToolContext): ToolContext {
    const approvals = context.approvals;
    return {
      ...context,
      signal: this.signal,
      ...(approvals
        ? {
            approvals: {
              wait: async (...args: Parameters<typeof approvals.wait>) => {
                const resume = this.#pause();
                try {
                  return await approvals.wait(...args);
                } finally {
                  resume();
                }
              },
            },
          }
        : {}),
    };
  }

  cancel(): void {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.parent.removeEventListener("abort", this.#forward);
  }
}
