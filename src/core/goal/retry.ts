import type { RetryDecision, RetryFailure, RetryFailureKind, RetryPolicyOptions } from "./types";

const FAILURE_KINDS: readonly RetryFailureKind[] = [
  "rate_limit",
  "quota_5h",
  "quota_weekly",
  "billing",
  "network",
  "server",
  "auth",
  "context",
  "bad_request",
  "unknown",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFailureKind(value: unknown): value is RetryFailureKind {
  return typeof value === "string" && (FAILURE_KINDS as readonly string[]).includes(value);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function headerOf(headers: unknown, name: string): unknown {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (!isRecord(headers)) return undefined;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return undefined;
}

function secondsOrDate(value: unknown, now: number): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return Math.max(0, Math.round(value * 1000));
  }
  if (typeof value === "string") {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return undefined;
}

function retryAfterMsOf(error: Record<string, unknown>, now: number): number | undefined {
  const direct = numberValue(error.retryAfterMs);
  if (direct !== undefined) return Math.max(0, Math.round(direct));
  const retryAfter = numberValue(error.retryAfter);
  if (retryAfter !== undefined) return Math.max(0, Math.round(retryAfter * 1000));
  return secondsOrDate(headerOf(error.headers, "retry-after"), now);
}

function epochMilliseconds(value: number): number {
  if (value >= 1_000_000_000 && value < 1_000_000_000_000) return value * 1000;
  return value;
}

function timeOf(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return Math.round(epochMilliseconds(value));
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.round(epochMilliseconds(numeric));
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.round(date);
  }
  return undefined;
}

function resetAtOf(error: Record<string, unknown>): number | undefined {
  return timeOf(error.resetAt);
}

function statusOf(error: Record<string, unknown>): number | undefined {
  const direct = numberValue(error.status) ?? numberValue(error.statusCode);
  if (direct !== undefined) return direct;
  const response = responseOf(error.response);
  return response === undefined ? undefined : numberValue(response.status);
}

function responseOf(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isNetworkCode(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const code = value.toUpperCase();
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED"
  );
}

/** Provider limit kinds from the transport layer (`LimitKind` in src/providers/limit-windows.ts). */
const LIMIT_KINDS: Record<string, RetryFailureKind> = {
  rate: "rate_limit",
  five_hour: "quota_5h",
  weekly: "quota_weekly",
  billing: "billing",
};

/** Provider error codes that mean the request does not fit the context window. */
const CONTEXT_CODES = new Set(["context_length_exceeded", "request_too_large"]);

function limitKindOf(value: unknown): RetryFailureKind | undefined {
  return typeof value === "string" ? LIMIT_KINDS[value] : undefined;
}

function transportKind(error: Record<string, unknown>): RetryFailureKind | undefined {
  if (typeof error.providerCode === "string" && CONTEXT_CODES.has(error.providerCode)) {
    return "context";
  }
  // A stream that went silent or a dropped connection: the transport reason says so.
  if (error.reason === "timeout" || error.reason === "network") return "network";
  return undefined;
}

function kindFromStatus(
  status: number | undefined,
  hasRetryWindow: boolean,
  networkCode: boolean,
): RetryFailureKind {
  if (networkCode) return "network";
  if (status === 402) return "billing";
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 413) return "context";
  if (status === 408) return "network";
  if (status === 400 || status === 404 || status === 422) return "bad_request";
  if (status !== undefined && status >= 500 && status <= 599) return "server";
  if (hasRetryWindow) return "rate_limit";
  return "unknown";
}

export function classifyFailure(error: unknown): RetryFailure {
  const now = Date.now();
  if (!isRecord(error)) return { kind: "unknown" };
  const status = statusOf(error);
  const retryAfterMs = retryAfterMsOf(error, now);
  const resetAt = resetAtOf(error);
  const explicitKind = isFailureKind(error.kind) ? error.kind : undefined;
  const networkCode = isNetworkCode(error.code);
  const kind =
    explicitKind ??
    limitKindOf(error.limitKind) ??
    transportKind(error) ??
    kindFromStatus(status, retryAfterMs !== undefined || resetAt !== undefined, networkCode);
  const failure: RetryFailure = { kind };
  if (status !== undefined) failure.status = status;
  if (retryAfterMs !== undefined) failure.retryAfterMs = retryAfterMs;
  if (resetAt !== undefined) failure.resetAt = resetAt;
  if (typeof error.message === "string") failure.message = error.message;
  return failure;
}

function windowOf(failure: RetryFailure, now: number): number | undefined {
  if (failure.retryAfterMs !== undefined) {
    return Math.max(0, Math.round(failure.retryAfterMs));
  }
  if (failure.resetAt !== undefined) {
    const resetAt = timeOf(failure.resetAt);
    if (resetAt !== undefined) return Math.max(0, resetAt - now);
  }
  return undefined;
}

const NOT_RETRYABLE = new Set<RetryFailureKind>(["auth", "bad_request", "unknown", "billing"]);

function isLimit(kind: RetryFailureKind): boolean {
  return kind === "rate_limit" || kind === "quota_5h" || kind === "quota_weekly";
}

export class RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter: number;
  readonly circuitBreakerThreshold: number;
  readonly circuitBreakerCooldownMs: number;
  readonly rateLimitWindowMs: number;
  readonly quotaWindowMs: number;
  readonly maxLimitWaitMs: number;
  readonly maxLimitWaits: number;

  private readonly random: () => number;
  private readonly now: () => number;
  private failures = 0;
  private attempts = 0;
  private openUntil = 0;
  private limitWaits = 0;
  private compactions = 0;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.jitter = Math.min(1, Math.max(0, options.jitter ?? 0.2));
    this.circuitBreakerThreshold = options.circuitBreakerThreshold ?? 5;
    this.circuitBreakerCooldownMs = options.circuitBreakerCooldownMs ?? 60_000;
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? 60_000;
    this.quotaWindowMs = options.quotaWindowMs ?? 1_800_000;
    this.maxLimitWaitMs = options.maxLimitWaitMs ?? 6 * 3_600_000;
    this.maxLimitWaits = options.maxLimitWaits ?? 12;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  classify(error: unknown): RetryFailure {
    return classifyFailure(error);
  }

  isOpen(): boolean {
    if (this.openUntil === 0) return false;
    if (this.now() < this.openUntil) return true;
    this.openUntil = 0;
    this.failures = 0;
    return false;
  }

  recordFailure(): boolean {
    this.failures += 1;
    if (this.failures < this.circuitBreakerThreshold) return false;
    this.openUntil = this.now() + this.circuitBreakerCooldownMs;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.attempts = 0;
    this.openUntil = 0;
    this.limitWaits = 0;
    this.compactions = 0;
  }

  delay(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined) return Math.max(0, Math.round(retryAfterMs));
    const ceiling = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, attempt));
    const spread = ceiling * this.jitter * (this.random() * 2 - 1);
    return Math.max(0, Math.round(Math.min(this.maxDelayMs, ceiling + spread)));
  }

  /**
   * Network and server failures use the attempt budget and the circuit breaker. Limits wait for
   * the reset the provider reported, with their own counter, so a 5-hour window does not burn
   * the network budget. Context overflow gets one retry after compaction.
   */
  decide(failure: RetryFailure, attempt?: number): RetryDecision {
    const kind = failure.kind;
    const current = attempt === undefined ? this.attempts : attempt;
    this.attempts =
      attempt === undefined ? this.attempts + 1 : Math.max(this.attempts, attempt + 1);

    if (NOT_RETRYABLE.has(kind)) {
      return { retry: false, delayMs: 0, reason: `${kind} failures are not retryable`, kind };
    }
    if (kind === "context") {
      if (this.compactions >= 1) {
        return { retry: false, delayMs: 0, reason: "context failures are not retryable", kind };
      }
      this.compactions += 1;
      return {
        retry: true,
        delayMs: 0,
        reason: "context overflow, compact and retry",
        kind,
        compact: true,
      };
    }
    if (isLimit(kind)) return this.#limitDecision(failure);
    return this.#transientDecision(kind, current);
  }

  #limitDecision(failure: RetryFailure): RetryDecision {
    const kind = failure.kind;
    const now = this.now();
    const window = windowOf(failure, now);
    if (kind === "quota_weekly" && window === undefined) {
      return { retry: false, delayMs: 0, reason: "weekly limit without a reset time", kind };
    }
    const delayMs = window ?? (kind === "rate_limit" ? this.rateLimitWindowMs : this.quotaWindowMs);
    if (delayMs > this.maxLimitWaitMs) {
      return { retry: false, delayMs, reason: "limit resets later than the wait cap", kind };
    }
    if (this.limitWaits >= this.maxLimitWaits) {
      return {
        retry: false,
        delayMs: 0,
        reason: `limit persisted after ${this.limitWaits} waits`,
        kind,
      };
    }
    this.limitWaits += 1;
    return {
      retry: true,
      delayMs,
      reason: kind === "rate_limit" ? "rate limit reset window" : "subscription limit reset window",
      kind,
    };
  }

  #transientDecision(kind: RetryFailureKind, current: number): RetryDecision {
    const now = this.now();
    if (this.isOpen()) {
      return {
        retry: false,
        delayMs: Math.max(0, this.openUntil - now),
        reason: "circuit breaker is open",
        kind,
      };
    }
    if (current >= this.maxAttempts) {
      this.recordFailure();
      return {
        retry: false,
        delayMs: 0,
        reason: `retry budget exhausted after ${current} attempts`,
        kind,
      };
    }
    if (this.recordFailure()) {
      return {
        retry: false,
        delayMs: Math.max(0, this.openUntil - now),
        reason: "circuit breaker tripped",
        kind,
      };
    }
    return { retry: true, delayMs: this.delay(current), reason: `retryable ${kind} failure`, kind };
  }
}
