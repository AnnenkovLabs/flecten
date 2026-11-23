export interface PostHogBatchItem {
  event: string;
  distinct_id: string;
  timestamp: string;
  uuid: string;
  properties: Record<string, string | number | boolean>;
}

export interface PostHogTarget {
  apiKey: string;
  batchUrl: string;
}

export interface PostHogClientOptions {
  getTarget: () => PostHogTarget | null;
  fetchImpl?: typeof fetch;
  flushIntervalMs?: number;
  batchSize?: number;
  maxQueueSize?: number;
  now?: () => number;
}

export interface FlushOptions {
  timeoutMs?: number;
  throwOnError?: boolean;
  bypassBackoff?: boolean;
}

const DEFAULT_FLUSH_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_QUEUE_SIZE = 500;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 600_000;
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 413]);

export class PostHogClient {
  readonly #getTarget: () => PostHogTarget | null;
  readonly #fetch: typeof fetch;
  readonly #batchSize: number;
  readonly #maxQueueSize: number;
  readonly #now: () => number;
  readonly #queue: PostHogBatchItem[] = [];
  #timer: ReturnType<typeof setInterval> | undefined;
  #flushing: Promise<void> | null = null;
  #failures = 0;
  #backoffUntil = 0;
  #closed = false;

  constructor(options: PostHogClientOptions) {
    this.#getTarget = options.getTarget;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.#maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.#now = options.now ?? Date.now;
    const interval = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    if (interval > 0) {
      this.#timer = setInterval(() => {
        void this.flush();
      }, interval);
      this.#timer.unref?.();
    }
  }

  get queueLength(): number {
    return this.#queue.length;
  }

  enqueue(item: PostHogBatchItem): void {
    if (this.#closed) return;
    if (this.#queue.length >= this.#maxQueueSize) {
      this.#queue.splice(0, this.#queue.length - this.#maxQueueSize + 1);
    }
    this.#queue.push(item);
    if (this.#queue.length >= this.#batchSize) {
      void this.flush();
    }
  }

  clear(): void {
    this.#queue.length = 0;
    this.#failures = 0;
    this.#backoffUntil = 0;
  }

  async flush(options: FlushOptions = {}): Promise<void> {
    if (this.#flushing) {
      await this.#flushing;
      if (this.#queue.length === 0 || !options.throwOnError) return;
    }
    const task = this.#runFlush(options);
    this.#flushing = task;
    try {
      await task;
    } finally {
      if (this.#flushing === task) this.#flushing = null;
    }
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    await this.flush({ timeoutMs: 2_500, bypassBackoff: true }).catch(() => undefined);
  }

  async #runFlush(options: FlushOptions): Promise<void> {
    const target = this.#getTarget();
    if (!target || this.#queue.length === 0) return;
    if (!options.bypassBackoff && this.#now() < this.#backoffUntil) return;

    const timeoutMs = options.timeoutMs ?? 5_000;
    const maxRounds = options.bypassBackoff ? 20 : 4;
    for (let round = 0; round < maxRounds && this.#queue.length > 0; round++) {
      const batch = this.#queue.slice(0, this.#batchSize);
      try {
        const response = await this.#fetch(target.batchUrl, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: target.apiKey,
            historical_migration: false,
            batch,
          }),
        });
        await response.body?.cancel();
        if (response.ok) {
          this.#queue.splice(0, batch.length);
          this.#failures = 0;
          this.#backoffUntil = 0;
          continue;
        }
        if (NON_RETRYABLE_STATUSES.has(response.status)) {
          this.#queue.splice(0, batch.length);
          if (options.throwOnError) throw new Error(`PostHog HTTP ${response.status}`);
          return;
        }
        this.#recordFailure();
        if (options.throwOnError) throw new Error(`PostHog HTTP ${response.status}`);
        return;
      } catch (error) {
        this.#recordFailure();
        if (options.throwOnError) throw error;
        return;
      }
    }
  }

  #recordFailure(): void {
    this.#failures += 1;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (this.#failures - 1));
    this.#backoffUntil = this.#now() + delay;
  }
}
