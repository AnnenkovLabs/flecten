/**
 * Subscription usage windows from response headers. Only explicit protocol signals set a
 * window: Anthropic unified headers and Codex usage headers.
 */

/**
 * Which limit was hit: a short request rate, a five-hour or weekly subscription window, or an
 * empty balance (`billing`), where waiting does not help.
 */
export type LimitKind = "rate" | "five_hour" | "weekly" | "billing";

export type HeaderSource = Headers | Record<string, string> | undefined;

export interface WindowLimit {
  limited: boolean;
  kind: LimitKind;
  resetAt?: number;
}

export function headerValue(headers: HeaderSource, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

export function epochMs(value: string): number | undefined {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed >= 1_000_000_000_000 ? Math.round(parsed) : Math.round(parsed * 1_000);
}

function headerNumber(headers: HeaderSource, name: string): number | undefined {
  const value = headerValue(headers, name);
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

const UNIFIED = "anthropic-ratelimit-unified";

/** Claude subscription windows: `anthropic-ratelimit-unified-*` headers. */
export function unifiedLimit(headers: HeaderSource): WindowLimit | undefined {
  const status = headerValue(headers, `${UNIFIED}-status`)?.trim().toLowerCase();
  if (status === undefined) return undefined;
  const claim = headerValue(headers, `${UNIFIED}-representative-claim`)?.trim().toLowerCase();
  const fiveHour = headerValue(headers, `${UNIFIED}-5h-status`)?.trim().toLowerCase();
  const weekly = headerValue(headers, `${UNIFIED}-7d-status`)?.trim().toLowerCase();
  const kind: LimitKind =
    claim === "five_hour"
      ? "five_hour"
      : claim?.startsWith("seven_day") || (fiveHour !== "rejected" && weekly === "rejected")
        ? "weekly"
        : "five_hour";
  const windowReset = headerNumber(headers, `${UNIFIED}-${kind === "weekly" ? "7d" : "5h"}-reset`);
  const reset = headerNumber(headers, `${UNIFIED}-reset`) ?? windowReset;
  const resetAt = reset === undefined ? undefined : epochMs(String(reset));
  return { limited: status === "rejected", kind, ...(resetAt === undefined ? {} : { resetAt }) };
}

/** ChatGPT/Codex plan windows: `x-codex-primary-*` and `x-codex-secondary-*` headers. */
export function codexLimit(headers: HeaderSource, now: number): WindowLimit | undefined {
  let seen: WindowLimit | undefined;
  for (const window of ["primary", "secondary"]) {
    const used = headerNumber(headers, `x-codex-${window}-used-percent`);
    if (used === undefined) continue;
    const minutes = headerNumber(headers, `x-codex-${window}-window-minutes`);
    const resetAfter = headerNumber(headers, `x-codex-${window}-reset-after-seconds`);
    const resetAtSeconds = headerNumber(headers, `x-codex-${window}-reset-at`);
    const resetAt =
      resetAtSeconds !== undefined
        ? epochMs(String(resetAtSeconds))
        : resetAfter !== undefined
          ? now + Math.round(resetAfter * 1_000)
          : undefined;
    const kind: LimitKind =
      minutes === undefined || (minutes >= 60 && minutes < 1_440)
        ? "five_hour"
        : minutes >= 1_440
          ? "weekly"
          : "rate";
    const entry = { limited: used >= 100, kind, ...(resetAt === undefined ? {} : { resetAt }) };
    if (entry.limited) return entry;
    seen ??= entry;
  }
  return seen;
}
