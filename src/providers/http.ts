import { redact } from "../util/redact";
import { trimTrailingSlashes } from "../util/text";
import {
  parseRateLimit,
  providerErrorCode,
  type RateLimitState,
  rateLimitDelayMs,
  rateLimitState,
  recordRateLimit,
} from "./rate-limit";
import { type ProviderFetch, parseRetryAfterMs, sanitizeBody, TransportError } from "./transport";

export interface PostOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  retries?: number;
  providerId?: string;
  fetch?: ProviderFetch;
  random?: () => number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const MAX_RETRY_AFTER_MS = 30_000;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function retryDelayMs(
  attempt: number,
  retryAfterMs?: number,
  random: () => number = Math.random,
  baseMs = 500,
  maxMs = 8000,
): number {
  if (retryAfterMs !== undefined) return Math.max(0, Math.min(retryAfterMs, MAX_RETRY_AFTER_MS));
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  const jitter = 0.5 + Math.min(1, Math.max(0, random())) * 0.5;
  return Math.min(maxMs, Math.round(ceiling * jitter));
}

async function errorBody(response: Response, headers: Record<string, string>): Promise<string> {
  try {
    return sanitizeBody(await response.text(), headers);
  } catch {
    return "";
  }
}

/**
 * A subscription window, an empty balance or a long reset is the goal loop's job: it waits for
 * the reset with a visible countdown instead of hammering the API here.
 */
function waitsLong(limit: RateLimitState | undefined): boolean {
  if (!limit?.limited) return false;
  if (limit.kind !== undefined && limit.kind !== "rate") return true;
  return (limit.retryAfterMs ?? 0) > MAX_RETRY_AFTER_MS;
}

export function endpoint(baseUrl: string, path: string): string {
  const base = trimTrailingSlashes(baseUrl);
  if (base.endsWith("/v1") && path.startsWith("/v1/")) {
    return `${base}${path.slice(3)}`;
  }
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function postStream(options: PostOptions): Promise<Response> {
  const retries = options.retries ?? 2;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? wait;
  let lastError: unknown;
  options.signal.throwIfAborted();
  const waitMs = options.providerId ? rateLimitDelayMs(options.providerId) : 0;
  if (waitMs > 0 && options.providerId) {
    const known = rateLimitState(options.providerId);
    throw new TransportError(`provider rate limit active for ${waitMs} ms`, {
      reason: "http",
      status: 429,
      retryable: false,
      retryAfterMs: waitMs,
      limitKind: known?.kind,
      resetAt: known?.resetAt,
    });
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    options.signal.throwIfAborted();
    let response: Response;
    try {
      response = await doFetch(options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          ...options.headers,
        },
        body: JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal.aborted) throw error;
      lastError = error;
      if (error instanceof TransportError) {
        if (
          !error.retryable ||
          error.reason === "aborted" ||
          error.reason === "proxy" ||
          attempt === retries
        ) {
          throw error;
        }
        await sleep(
          retryDelayMs(
            attempt,
            error.retryAfterMs,
            options.random,
            options.retryBaseMs,
            options.retryMaxMs,
          ),
          options.signal,
        );
        continue;
      }
      if (attempt === retries) break;
      await sleep(
        retryDelayMs(attempt, undefined, options.random, options.retryBaseMs, options.retryMaxMs),
        options.signal,
      );
      continue;
    }

    if (response.ok) {
      if (options.providerId) {
        recordRateLimit(
          options.providerId,
          parseRateLimit({ status: response.status, headers: response.headers }),
        );
      }
      return response;
    }

    const body = await errorBody(response, options.headers);
    const limit = parseRateLimit({ status: response.status, headers: response.headers, body });
    if (options.providerId) recordRateLimit(options.providerId, limit);
    const retryAfterMs =
      (limit?.limited ? limit.retryAfterMs : undefined) ??
      parseRetryAfterMs(response.headers.get("retry-after"));
    const failure = {
      reason: "http" as const,
      status: response.status,
      retryAfterMs,
      bodyText: body,
      limitKind: limit?.kind,
      resetAt: limit?.resetAt,
      providerCode: providerErrorCode(body),
    };
    if (!RETRYABLE.has(response.status) || attempt === retries || waitsLong(limit)) {
      throw new TransportError(`provider returned ${response.status}${body ? `: ${body}` : ""}`, {
        ...failure,
        retryable: RETRYABLE.has(response.status) && limit?.kind !== "billing",
      });
    }
    lastError = new TransportError(`provider returned ${response.status}`, {
      ...failure,
      retryable: true,
    });
    await sleep(
      retryDelayMs(attempt, retryAfterMs, options.random, options.retryBaseMs, options.retryMaxMs),
      options.signal,
    );
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new TransportError(`provider request failed: ${redact(detail)}`, {
    reason: "network",
    retryable: true,
    cause: lastError,
  });
}
