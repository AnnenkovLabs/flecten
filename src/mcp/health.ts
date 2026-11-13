export type McpHealthState = "connecting" | "ready" | "degraded" | "closed";

export interface McpHealthCounters {
  attempts: number;
  successes: number;
  failures: number;
  reconnects: number;
}

export interface McpHealthSnapshot {
  state: McpHealthState;
  lastError?: string;
  nextRetryAt?: number;
  counters: McpHealthCounters;
}

export interface McpHealthOptions {
  connect: (signal: AbortSignal) => Promise<void>;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  now?: () => number;
  onChange?: (snapshot: McpHealthSnapshot) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class McpHealth {
  readonly #connect: (signal: AbortSignal) => Promise<void>;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #maxAttempts: number;
  readonly #now: () => number;
  readonly #onChange: ((snapshot: McpHealthSnapshot) => void) | undefined;
  readonly #counters: McpHealthCounters = {
    attempts: 0,
    successes: 0,
    failures: 0,
    reconnects: 0,
  };

  #state: McpHealthState = "connecting";
  #lastError: string | undefined;
  #nextRetryAt: number | undefined;
  #consecutiveFailures = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #controller: AbortController | undefined;
  #running = false;
  #started = false;

  constructor(options: McpHealthOptions) {
    this.#connect = options.connect;
    this.#baseDelayMs = Math.max(1, options.baseDelayMs ?? 250);
    this.#maxDelayMs = Math.max(1, options.maxDelayMs ?? 5000);
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    this.#now = options.now ?? Date.now;
    this.#onChange = options.onChange;
  }

  get state(): McpHealthState {
    return this.#state;
  }

  snapshot(): McpHealthSnapshot {
    return {
      state: this.#state,
      ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }),
      ...(this.#nextRetryAt === undefined ? {} : { nextRetryAt: this.#nextRetryAt }),
      counters: { ...this.#counters },
    };
  }

  start(): void {
    if (this.#closed() || this.#started) return;
    this.#started = true;
    void this.#attempt();
  }

  async reconnect(): Promise<void> {
    if (this.#closed()) throw new Error("MCP health is closed");
    if (this.#running) return;
    this.#started = true;
    this.#clearTimer();
    this.#consecutiveFailures = 0;
    await this.#attempt();
  }

  markDegraded(error: unknown): void {
    if (this.#closed() || this.#running) return;
    this.#lastError = errorMessage(error);
    this.#counters.failures += 1;
    this.#consecutiveFailures += 1;
    this.#scheduleRetry();
    this.#setState("degraded");
  }

  close(): void {
    if (this.#closed()) return;
    this.#state = "closed";
    this.#nextRetryAt = undefined;
    this.#clearTimer();
    this.#controller?.abort(new DOMException("MCP health closed", "AbortError"));
    this.#controller = undefined;
    this.#onChange?.(this.snapshot());
  }

  async #attempt(): Promise<void> {
    if (this.#closed() || this.#running) return;
    this.#running = true;
    this.#timer = undefined;
    this.#nextRetryAt = undefined;
    this.#setState("connecting");

    const controller = new AbortController();
    this.#controller = controller;
    this.#counters.attempts += 1;
    if (this.#counters.attempts > 1) this.#counters.reconnects += 1;

    try {
      await this.#connect(controller.signal);
      if (this.#closed()) return;
      this.#counters.successes += 1;
      this.#consecutiveFailures = 0;
      this.#lastError = undefined;
      this.#setState("ready");
    } catch (error) {
      if (this.#closed()) return;
      this.#counters.failures += 1;
      this.#consecutiveFailures += 1;
      this.#lastError = errorMessage(error);
      this.#scheduleRetry();
      this.#setState("degraded");
    } finally {
      this.#controller = undefined;
      this.#running = false;
    }
  }

  #scheduleRetry(): void {
    if (this.#consecutiveFailures >= this.#maxAttempts) return;
    this.#clearTimer();
    const delay = Math.min(
      this.#baseDelayMs * 2 ** (this.#consecutiveFailures - 1),
      this.#maxDelayMs,
    );
    this.#nextRetryAt = this.#now() + delay;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#attempt();
    }, delay);
  }

  #setState(state: McpHealthState): void {
    this.#state = state;
    this.#onChange?.(this.snapshot());
  }

  #clearTimer(): void {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #closed(): boolean {
    return this.#state === "closed";
  }
}
