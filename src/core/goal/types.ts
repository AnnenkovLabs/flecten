export type GoalStatus = "active" | "met" | "blocked" | "paused";

export type GoalAction = "continue" | "finish" | "ask" | "blocked";

export interface GoalBudget {
  maxAttempts?: number;
  maxDurationMs?: number;
}

export interface GoalEvidenceInput {
  detail: string;
  criterion?: number;
}

export interface GoalTodo {
  content: string;
  status: string;
}

export interface GoalSnapshot {
  objective: string;
  status: GoalStatus;
  remainingCriteria: string[];
  evidenceCount: number;
}

export interface GoalInit {
  id: string;
  objective: string;
  criteria: readonly string[];
  budget?: GoalBudget;
  startedAt?: number;
  now?: () => number;
}

export interface GoalTurnResult {
  text?: string;
  complete?: boolean;
  summary?: string;
  blocked?: boolean;
  reason?: string;
  requiresUser?: boolean;
}

export interface GoalDecision {
  action: GoalAction;
  reason: string;
}

export type RetryFailureKind =
  | "rate_limit"
  | "quota_5h"
  | "quota_weekly"
  | "billing"
  | "network"
  | "server"
  | "auth"
  | "context"
  | "bad_request"
  | "unknown";

export interface RetryFailure {
  kind: RetryFailureKind;
  status?: number;
  retryAfterMs?: number;
  resetAt?: number | string;
  message?: string;
}

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: string;
  kind: RetryFailureKind;
  /** The provider said the request is too large: compact the context, then retry. */
  compact?: boolean;
}

export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerCooldownMs?: number;
  rateLimitWindowMs?: number;
  /** Probe interval for a subscription window whose reset time the provider did not send. */
  quotaWindowMs?: number;
  /** Longest single wait for a limit reset; a later reset ends the run with the reset time. */
  maxLimitWaitMs?: number;
  /** Limit waits in a row before the run stops; they do not use the network retry budget. */
  maxLimitWaits?: number;
  random?: () => number;
  now?: () => number;
}

export interface CompletionSignal {
  text: string;
  summary: string;
  complete: boolean;
}
