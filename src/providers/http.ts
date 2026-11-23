import { cleanProviderBaseUrl } from "../../shared/provider-url";
import { isObject } from "../util/json";
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
import { classifyStreamError } from "./sse";
import { type ProviderFetch, parseRetryAfterMs, sanitizeBody, TransportError } from "./transport";

export interface PostOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
  retries?: number;
  providerId?: string;
  model?: string;
  quotaGroup?: string;
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

/** Strips accidentally pasted endpoint suffixes and repairs user-typed URLs cleanly. */
export function normalizeBaseUrl(baseUrl: string): string {
  const cleaned = cleanProviderBaseUrl(baseUrl);
  return cleaned.ok ? cleaned.baseUrl : trimTrailingSlashes(baseUrl.trim());
}

export function endpoint(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (base.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
    return `${base}${normalizedPath.slice(3)}`;
  }
  return `${base}${normalizedPath}`;
}

export async function postStream(options: PostOptions): Promise<Response> {
  const retries = options.retries ?? 2;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? wait;
  let lastError: unknown;
  options.signal.throwIfAborted();
  const waitMs = options.providerId
    ? rateLimitDelayMs(options.providerId, Date.now(), options.model, options.quotaGroup)
    : 0;
  const known = options.providerId
    ? rateLimitState(options.providerId, Date.now(), options.model, options.quotaGroup)
    : undefined;
  if ((waitMs > 0 || (known?.limited && known.kind === "model_quota")) && options.providerId) {
    throw new TransportError(
      known?.resetAt === undefined
        ? "provider quota exhausted without a reset time"
        : `provider rate limit active for ${waitMs} ms`,
      {
        requested: false,
        reason: "http",
        status: known?.status !== undefined && known.status >= 400 ? known.status : 429,
        retryable: false,
        ...(known?.resetAt === undefined ? {} : { retryAfterMs: waitMs }),
        limitKind: known?.kind,
        resetAt: known?.resetAt,
        providerCode: known?.providerCode,
      },
    );
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
          options.model,
          options.quotaGroup,
        );
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.includes("application/json") && !contentType.includes("text/event-stream")) {
        const rawText = await response.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = undefined;
        }
        if (isObject(parsed) && parsed.error !== undefined) {
          const safeBody = sanitizeBody(rawText, options.headers);
          const classified = classifyStreamError(parsed);
          const safeMessage = sanitizeBody(classified.message, options.headers);
          const limit = parseRateLimit({
            status: response.status,
            headers: response.headers,
            body: safeBody,
          });
          if (options.providerId && limit?.limited) {
            recordRateLimit(options.providerId, limit, options.model, options.quotaGroup);
          }
          const retryable =
            (classified.kind === "server" || classified.kind === "rate_limit") &&
            limit?.kind !== "billing";
          const failure = {
            reason: "http" as const,
            status:
              classified.kind === "rate_limit" ? 429 : classified.kind === "unknown" ? 400 : 502,
            retryAfterMs: limit?.limited ? limit.retryAfterMs : undefined,
            bodyText: safeBody,
            limitKind: limit?.kind,
            resetAt: limit?.resetAt,
            providerCode: providerErrorCode(safeBody),
          };
          if (!retryable || attempt === retries || waitsLong(limit)) {
            throw new TransportError(`provider error: ${safeMessage}`, {
              ...failure,
              retryable,
            });
          }
          lastError = new TransportError(`provider error: ${safeMessage}`, {
            ...failure,
            retryable: true,
          });
          await sleep(
            retryDelayMs(
              attempt,
              failure.retryAfterMs,
              options.random,
              options.retryBaseMs,
              options.retryMaxMs,
            ),
            options.signal,
          );
          continue;
        }
        return new Response(rawText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      return response;
    }

    const body = await errorBody(response, options.headers);
    const limit = parseRateLimit({ status: response.status, headers: response.headers, body });
    if (options.providerId)
      recordRateLimit(options.providerId, limit, options.model, options.quotaGroup);
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
