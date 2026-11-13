import { isObject } from "../util/json";
import {
  codexLimit,
  epochMs,
  type HeaderSource,
  headerValue,
  type LimitKind,
  unifiedLimit,
} from "./limit-windows";
import { parseRetryAfterMs } from "./transport";

export type RateLimitSource = "status" | "headers" | "body";

export type { LimitKind } from "./limit-windows";

export interface RateLimitState {
  limited: boolean;
  kind?: LimitKind;
  resetAt?: number;
  retryAfterMs?: number;
  remaining?: number;
  limit?: number;
  status?: number;
  source: RateLimitSource;
  updatedAt: number;
}

const states = new Map<string, RateLimitState>();

const LIMITED_MARKERS = new Set([
  "rate_limit",
  "rate_limit_error",
  "rate_limit_exceeded",
  "rate_limited",
  "too_many_requests",
  "resource_exhausted",
  "quota_exceeded",
]);

/** Subscription usage windows: ChatGPT/Codex `usage_limit_reached`. */
const USAGE_MARKERS = new Set(["usage_limit_reached", "usage_limit_exceeded"]);

/** Money, not time: the request fails until the balance or plan changes. */
const BILLING_MARKERS = new Set([
  "insufficient_quota",
  "billing_hard_limit_reached",
  "billing_not_active",
  "payment_required",
  "insufficient_credits",
]);

const DAY_MS = 86_400_000;

const REMAINING_HEADERS = [
  "anthropic-ratelimit-requests-remaining",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining",
  "anthropic-ratelimit-tokens-remaining",
  "x-ratelimit-remaining-tokens",
];

const LIMIT_HEADERS = [
  "anthropic-ratelimit-requests-limit",
  "x-ratelimit-limit-requests",
  "x-ratelimit-limit",
  "anthropic-ratelimit-tokens-limit",
  "x-ratelimit-limit-tokens",
];

function firstHeader(headers: HeaderSource, names: string[]): number | undefined {
  for (const name of names) {
    const value = headerValue(headers, name);
    if (value === undefined) continue;
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

export function parseDurationMs(value: string): number | undefined {
  const text = value.trim();
  if (text.length === 0) return undefined;
  let index = 0;
  let total = 0;
  let seen = false;
  while (index < text.length) {
    const start = index;
    while (index < text.length) {
      const char = text[index] ?? "";
      if ((char >= "0" && char <= "9") || char === ".") index += 1;
      else break;
    }
    if (start === index) return undefined;
    const amount = Number(text.slice(start, index));
    if (!Number.isFinite(amount)) return undefined;
    const unitStart = index;
    while (index < text.length) {
      const char = text[index] ?? "";
      if (char >= "a" && char <= "z") index += 1;
      else break;
    }
    const unit = text.slice(unitStart, index);
    const factor =
      unit === "ms"
        ? 1
        : unit === "s"
          ? 1_000
          : unit === "m"
            ? 60_000
            : unit === "h"
              ? 3_600_000
              : unit === "d"
                ? 86_400_000
                : undefined;
    if (factor === undefined) return undefined;
    total += amount * factor;
    seen = true;
  }
  return seen ? Math.round(total) : undefined;
}

function resetFromHeaders(
  headers: HeaderSource,
  now: number,
): { resetAt?: number; source: boolean } {
  const retryAfter = headerValue(headers, "retry-after");
  const retryAfterMs = parseRetryAfterMs(retryAfter ?? null, now);
  if (retryAfterMs !== undefined) return { resetAt: now + retryAfterMs, source: true };

  const anthropicReset = headerValue(headers, "anthropic-ratelimit-requests-reset");
  if (anthropicReset) {
    const timestamp = Date.parse(anthropicReset);
    if (Number.isFinite(timestamp)) return { resetAt: Math.max(now, timestamp), source: true };
  }

  const durationReset = headerValue(headers, "x-ratelimit-reset-requests");
  if (durationReset) {
    const duration = parseDurationMs(durationReset);
    if (duration !== undefined) return { resetAt: now + duration, source: true };
  }

  const genericReset = headerValue(headers, "x-ratelimit-reset");
  if (genericReset) {
    const timestamp = epochMs(genericReset);
    if (timestamp !== undefined) return { resetAt: Math.max(now, timestamp), source: true };
    const duration = parseDurationMs(genericReset);
    if (duration !== undefined) return { resetAt: now + duration, source: true };
  }
  return { source: false };
}

function errorObject(body: unknown): Record<string, unknown> | undefined {
  let value = body;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!isObject(value)) return undefined;
  return isObject(value.error) ? value.error : value;
}

function markersOf(error: Record<string, unknown>): string[] {
  return [error.code, error.type, error.status, error.reason]
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase());
}

/** The provider's own error code (`context_length_exceeded`, `overloaded_error`...). */
export function providerErrorCode(body: unknown): string | undefined {
  const error = errorObject(body);
  if (!error) return undefined;
  for (const value of [error.code, error.type]) {
    if (typeof value === "string" && value.trim() !== "") return value.trim().toLowerCase();
  }
  return undefined;
}

function bodyRateLimit(
  body: unknown,
  now: number,
): { limited: boolean; kind?: LimitKind; resetAt?: number; source: boolean } | undefined {
  const error = errorObject(body);
  if (!error) return undefined;
  const markers = markersOf(error);
  const billing = markers.some((marker) => BILLING_MARKERS.has(marker));
  const usage = markers.some((marker) => USAGE_MARKERS.has(marker));
  const limited = billing || usage || markers.some((marker) => LIMITED_MARKERS.has(marker));

  let resetAt: number | undefined;
  const resetsIn = error.resets_in_seconds;
  if (typeof resetsIn === "number" && Number.isFinite(resetsIn) && resetsIn >= 0) {
    resetAt = now + Math.round(resetsIn * 1_000);
  }
  const candidates = [error.retry_after, error.retryAfter, error.reset_at, error.resets_at];
  const details = Array.isArray(error.details) ? error.details : [];
  for (const detail of details) {
    if (!isObject(detail)) continue;
    candidates.push(detail.retryDelay, detail.retry_after, detail.reset_at);
    if (isObject(detail.metadata)) {
      candidates.push(detail.metadata.retry_after, detail.metadata.reset_at);
    }
  }
  for (const candidate of resetAt === undefined ? candidates : []) {
    if (candidate === undefined) continue;
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) {
      resetAt = candidate > 1_000_000_000 ? epochMs(String(candidate)) : now + candidate * 1_000;
    } else if (typeof candidate === "string") {
      const duration = parseDurationMs(candidate);
      if (duration !== undefined) resetAt = now + duration;
      else {
        const timestamp = Date.parse(candidate);
        if (Number.isFinite(timestamp)) resetAt = Math.max(now, timestamp);
        else {
          const epoch = epochMs(candidate);
          if (epoch !== undefined) resetAt = Math.max(now, epoch);
        }
      }
    }
    if (resetAt !== undefined) break;
  }

  if (!limited && resetAt === undefined) return undefined;
  const kind: LimitKind | undefined = billing
    ? "billing"
    : usage
      ? resetAt !== undefined && resetAt - now > DAY_MS
        ? "weekly"
        : "five_hour"
      : undefined;
  return {
    limited,
    ...(kind ? { kind } : {}),
    ...(resetAt === undefined ? {} : { resetAt }),
    source: true,
  };
}

export interface RateLimitInput {
  status?: number;
  headers?: Headers | Record<string, string>;
  body?: unknown;
  now?: number;
}

export function parseRateLimit(input: RateLimitInput): RateLimitState | undefined {
  const now = input.now ?? Date.now();
  const headerReset = resetFromHeaders(input.headers, now);
  const remaining = firstHeader(input.headers, REMAINING_HEADERS);
  const limit = firstHeader(input.headers, LIMIT_HEADERS);
  const body = bodyRateLimit(input.body, now);
  const window = unifiedLimit(input.headers) ?? codexLimit(input.headers, now);
  const windowHit = window?.limited === true;
  const limited =
    input.status === 429 ||
    input.status === 402 ||
    body?.limited === true ||
    remaining === 0 ||
    windowHit;
  const resetAt = windowHit
    ? (window?.resetAt ?? headerReset.resetAt ?? body?.resetAt)
    : (headerReset.resetAt ?? body?.resetAt);
  const kind: LimitKind | undefined =
    body?.kind ??
    (input.status === 402 ? "billing" : undefined) ??
    (windowHit ? window?.kind : undefined) ??
    (limited ? "rate" : undefined);

  if (!limited && remaining === undefined && limit === undefined && resetAt === undefined) {
    return undefined;
  }
  const source: RateLimitSource =
    headerReset.source || window ? "headers" : body?.source ? "body" : "status";
  return {
    limited,
    ...(kind ? { kind } : {}),
    ...(resetAt === undefined ? {} : { resetAt, retryAfterMs: Math.max(0, resetAt - now) }),
    ...(remaining === undefined ? {} : { remaining }),
    ...(limit === undefined ? {} : { limit }),
    ...(input.status === undefined ? {} : { status: input.status }),
    source,
    updatedAt: now,
  };
}

export function recordRateLimit(providerId: string, state: RateLimitState | undefined): void {
  if (!state) return;
  states.set(providerId, state);
}

export function rateLimitState(providerId: string, now = Date.now()): RateLimitState | undefined {
  const state = states.get(providerId);
  if (!state) return undefined;
  if (state.limited && state.resetAt !== undefined && state.resetAt <= now) {
    return { ...state, limited: false, retryAfterMs: 0 };
  }
  return state;
}

export function rateLimitDelayMs(providerId: string, now = Date.now()): number {
  const state = rateLimitState(providerId, now);
  if (!state?.limited || state.resetAt === undefined) return 0;
  return Math.max(0, state.resetAt - now);
}

export function resetRateLimits(): void {
  states.clear();
}
