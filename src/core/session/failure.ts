import { HarnessError, LimitError } from "../../errors";
import { RetryPolicy } from "../goal/retry";
import type { Event, SessionId } from "../types";

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Eight network attempts with backoff from 1 s to 30 s ride out about two minutes of outage.
 * Limits wait for their reset separately and do not use this budget.
 */
export function sessionRetryPolicy(): RetryPolicy {
  return new RetryPolicy({ maxAttempts: 8, baseDelayMs: 1_000, circuitBreakerThreshold: 9 });
}

/** The error event of a failed run; a provider limit carries its kind and reset time. */
export function failureEvent(sessionId: SessionId, error: unknown, message: string): Event {
  return {
    type: "error",
    sessionId,
    code: error instanceof HarnessError ? error.code : "provider_failed",
    message,
    ...(error instanceof LimitError ? { limit: error.limit } : {}),
    ...(error instanceof LimitError && error.resetAt !== undefined
      ? { resetAt: error.resetAt }
      : {}),
  };
}

/** Environment variables the sandbox lets through, read from the sidecar environment. */
export function allowedEnv(allowlist: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    allowlist.flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value] as const];
    }),
  );
}
