import type { ModelEvent, StopReason } from "./types";

export type StreamFinishReason = StopReason | "refusal" | "content_filter" | "safety";

export type StreamErrorKind =
  | "network"
  | "timeout"
  | "rate_limit"
  | "server"
  | "content_filter"
  | "safety"
  | "filtered"
  | "aborted"
  | "unknown";

export interface StreamErrorEvent {
  type: "error";
  kind: StreamErrorKind;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
}

type ModelStreamEvent = Exclude<ModelEvent, { type: "done" }>;

export type StreamEvent =
  | ModelStreamEvent
  | { type: "done"; reason: StreamFinishReason }
  | StreamErrorEvent;

export type StreamStatus = "complete" | "incomplete" | "refused" | "filtered" | "truncated";

export type RecoveryRetry = "none" | "restart" | "resume";

export interface StreamAssessment {
  status: StreamStatus;
  retry: RecoveryRetry;
  reason: string;
  safeToContinue: boolean;
  errorKind?: StreamErrorKind;
  retryAfterMs?: number;
}

export interface RecoveryDecision {
  action: "restart" | "resume" | "fail";
  delayMs: number;
  dropPartial: boolean;
  reason: string;
}

const encoder = new TextEncoder();

export class StreamTracker {
  terminal = false;
  finishReason: StreamFinishReason | undefined;
  lastSeq = 0;
  bytes = 0;
  toolCallCount = 0;
  sawDone = false;
  sawUsage = false;
  error: StreamErrorEvent | undefined;

  feed(event: StreamEvent): void {
    this.lastSeq += 1;
    switch (event.type) {
      case "text":
      case "reasoning":
        this.bytes += encoder.encode(event.delta).byteLength;
        break;
      case "tool_call":
        this.toolCallCount += 1;
        break;
      case "done":
        this.sawDone = true;
        this.terminal = true;
        this.finishReason = event.reason;
        break;
      case "usage":
        this.sawUsage = true;
        break;
      case "error":
        this.error = event;
        this.terminal = true;
        break;
      default:
        break;
    }
  }
}

function assessment(
  status: StreamStatus,
  retry: RecoveryRetry,
  reason: string,
  safeToContinue: boolean,
  error?: StreamErrorEvent,
): StreamAssessment {
  return {
    status,
    retry,
    reason,
    safeToContinue,
    ...(error === undefined
      ? {}
      : {
          errorKind: error.kind,
          ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
        }),
  };
}

function isRetryable(error: StreamErrorEvent): boolean {
  if (error.retryable !== undefined) return error.retryable;
  return (
    error.kind === "network" ||
    error.kind === "timeout" ||
    error.kind === "rate_limit" ||
    error.kind === "server"
  );
}

function partialRecovery(tracker: StreamTracker): RecoveryRetry {
  return tracker.bytes > 0 || tracker.toolCallCount > 0 ? "resume" : "restart";
}

export function assessStream(tracker: StreamTracker): StreamAssessment {
  if (tracker.sawDone) {
    if (tracker.finishReason === "max_tokens") {
      return assessment("truncated", "none", "output token limit reached", true);
    }
    if (
      tracker.finishReason === "refusal" ||
      tracker.finishReason === "content_filter" ||
      tracker.finishReason === "safety"
    ) {
      return assessment("refused", "none", `finish reason: ${tracker.finishReason}`, false);
    }
    return assessment("complete", "none", "terminal done event", true);
  }

  const error = tracker.error;
  if (!error) {
    return assessment(
      "incomplete",
      partialRecovery(tracker),
      "stream ended without a terminal event",
      false,
    );
  }
  if (error.kind === "content_filter" || error.kind === "safety") {
    return assessment("refused", "none", `stream error: ${error.kind}`, false, error);
  }
  if (error.kind === "filtered") {
    return assessment("filtered", "none", "stream error: filtered", false, error);
  }
  if (error.kind === "aborted") {
    return assessment("incomplete", "none", "stream error: aborted", false, error);
  }
  if (!isRetryable(error)) {
    return assessment("incomplete", "none", `stream error: ${error.kind}`, false, error);
  }
  return assessment(
    "incomplete",
    partialRecovery(tracker),
    `stream error: ${error.kind}`,
    false,
    error,
  );
}

export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  rateLimitResetMs?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerCooldownMs?: number;
  supportsResume?: boolean;
  random?: () => number;
  now?: () => number;
}

export class RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter: number;
  readonly rateLimitResetMs: number;
  readonly circuitBreakerThreshold: number;
  readonly circuitBreakerCooldownMs: number;
  readonly supportsResume: boolean;
  private readonly random: () => number;
  private readonly now: () => number;
  private failures = 0;
  private openUntil = 0;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.jitter = Math.min(1, Math.max(0, options.jitter ?? 0.2));
    this.rateLimitResetMs = options.rateLimitResetMs ?? 30_000;
    this.circuitBreakerThreshold = options.circuitBreakerThreshold ?? 5;
    this.circuitBreakerCooldownMs = options.circuitBreakerCooldownMs ?? 60_000;
    this.supportsResume = options.supportsResume ?? false;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
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
    this.openUntil = 0;
  }

  delay(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined) return Math.max(0, Math.round(retryAfterMs));
    const ceiling = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, attempt));
    const spread = ceiling * this.jitter * (this.random() * 2 - 1);
    return Math.max(0, Math.round(Math.min(this.maxDelayMs, ceiling + spread)));
  }
}

function fail(reason: string, dropPartial = true): RecoveryDecision {
  return { action: "fail", delayMs: 0, dropPartial, reason };
}

export function decideRecovery(
  assessment: StreamAssessment,
  attempt: number,
  policy: RetryPolicy,
): RecoveryDecision {
  if (assessment.status === "complete") {
    return fail("nothing to recover: stream completed", false);
  }
  if (assessment.status === "truncated") {
    return fail("nothing to recover: output limit reached; use normal continuation", false);
  }
  if (assessment.status === "refused" || assessment.status === "filtered") {
    return fail(assessment.reason);
  }
  if (assessment.retry === "none") {
    return fail(assessment.reason);
  }
  if (policy.isOpen()) {
    return fail("circuit breaker is open");
  }
  if (attempt >= policy.maxAttempts) {
    policy.recordFailure();
    return fail(`retry budget exhausted after ${attempt} attempts`);
  }
  if (policy.recordFailure()) {
    return fail("circuit breaker tripped");
  }

  const resume = assessment.retry === "resume" && policy.supportsResume;
  const retryAfterMs =
    assessment.errorKind === "rate_limit"
      ? (assessment.retryAfterMs ?? policy.rateLimitResetMs)
      : undefined;
  return {
    action: resume ? "resume" : "restart",
    delayMs: policy.delay(attempt, retryAfterMs),
    dropPartial: !resume,
    reason: `${resume ? "resume" : "restart"} after ${assessment.reason}`,
  };
}
