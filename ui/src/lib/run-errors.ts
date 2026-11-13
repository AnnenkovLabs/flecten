import { i18n, t } from "./i18n.svelte";
/** Error cards and retry status: user-facing reasons, reset times and the continue rule. */

export type LimitKind = "rate" | "five_hour" | "weekly" | "billing";

export interface ErrorItem {
  kind: "error";
  id: string;
  text: string;
  code?: string;
  at?: string;
  /** Provider limit that ended the run and, when known, its reset time (epoch ms). */
  limit?: LimitKind;
  resetAt?: number;
}

const ERROR_REASONS: Record<string, string> = {
  get invalid_input() {
    return t("Request rejected. Check your message and settings.");
  },
  get provider_failed() {
    return t("The provider did not respond. Check your API key, model, and network connection.");
  },
  get context_overflow() {
    return t("Context is full. Compress the history or start a new task.");
  },
  get cancelled() {
    return t("Run canceled.");
  },
  get startup_failed() {
    return t("The core could not start. Check your installation and settings.");
  },
  get project_locked() {
    return t(
      "This project is already open in another Flecten window. Close it and send the message again, or open a different project.",
    );
  },
  get protocol() {
    return t("The core returned an invalid response.");
  },
  get config() {
    return t("The provider is not configured. Open Settings and check the key.");
  },
  get agent_exit() {
    return t("Connection to the core was lost. Start the task again.");
  },
  get bridge() {
    return t("The core is only available in the app.");
  },
  get provider_limit() {
    return t("The provider reached its limit.");
  },
};

const LIMIT_REASONS: Record<LimitKind, string> = {
  get rate() {
    return t("The provider rate-limited requests.");
  },
  get five_hour() {
    return t("The subscription's 5-hour limit has been reached.");
  },
  get weekly() {
    return t("The subscription's weekly limit has been reached.");
  },
  get billing() {
    return t("Your provider account has run out of funds. Add funds or use a different key.");
  },
};

/** Errors after which the task goes on from history; the card offers «Продолжить». */
const RESUMABLE = new Set(["provider_failed", "provider_limit", "context_overflow", "agent_exit"]);

export function formatReset(at: number, now: number = Date.now()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit" });
  if (new Date(now).toDateString() === date.toDateString()) return t("at {0}", [time]);
  const day = date.toLocaleDateString(i18n.locale, { day: "numeric", month: "long" });
  return t("{0} at {1}", [day, time]);
}

export function errorReason(item: ErrorItem, now: number = Date.now()): string {
  if (item.limit) {
    const base = LIMIT_REASONS[item.limit];
    return item.resetAt === undefined
      ? base
      : t("{0} Resets {1}.", [base, formatReset(item.resetAt, now)]);
  }
  return (
    ERROR_REASONS[item.code ?? ""] ?? t("The run stopped with an error. See the reason below.")
  );
}

export function canContinue(item: ErrorItem): boolean {
  return item.limit !== "billing" && RESUMABLE.has(item.code ?? "provider_failed");
}

const RETRY_LABELS: Record<string, string> = {
  get rate_limit() {
    return t("Rate limit");
  },
  get quota_5h() {
    return t("5-hour limit");
  },
  get quota_weekly() {
    return t("Weekly limit");
  },
  get network() {
    return t("No connection to provider");
  },
  get server() {
    return t("Provider overloaded");
  },
  get context() {
    return t("Compacting context and retrying");
  },
};

export function retryLabel(kind: string): string {
  return RETRY_LABELS[kind] ?? t("Retrying request");
}

const FALLBACK_REASONS: Record<string, string> = {
  get rate_limit() {
    return t("the primary model hit its rate limit");
  },
  get quota() {
    return t("the primary model ran out of quota");
  },
  get server() {
    return t("the primary model's provider is overloaded");
  },
  get network() {
    return t("no connection to the primary model");
  },
  get timeout() {
    return t("the primary model did not respond in time");
  },
  get proxy() {
    return t("the proxy blocked the request to the primary model");
  },
  get circuit_open() {
    return t("the primary model failed recently, so the request went straight to the next model");
  },
};

/** Why failover moved the request, in words: the `reason` of `model.fallback`. */
export function fallbackReason(reason: string): string {
  return FALLBACK_REASONS[reason] ?? t("the primary model did not respond");
}

/** Countdown under the live status while a request waits for its retry. */
export function retryMeta(until: number, now: number): string {
  const left = until - now;
  if (left < 1_000) return t("sending again");
  if (left < 60_000) return t("retrying in {0} s", [Math.ceil(left / 1_000)]);
  if (left < 3_600_000) {
    return t("resuming automatically in {0} min, {1}", [
      Math.ceil(left / 60_000),
      formatReset(until, now),
    ]);
  }
  return t("resuming automatically {0}", [formatReset(until, now)]);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
