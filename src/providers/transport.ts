import { stat } from "node:fs/promises";
import { type ErrorCode, HarnessError } from "../errors";
import { atomicWrite } from "../util/atomic";
import { redact } from "../util/redact";
import type { LimitKind } from "./limit-windows";

const DEFAULT_TIMEOUT_MS = 120_000;
const BODY_LIMIT = 2_000;
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "proxy-authorization",
  "cookie",
]);

export type TransportErrorReason = "proxy" | "timeout" | "aborted" | "network" | "http";

export interface TransportErrorOptions {
  reason: TransportErrorReason;
  code?: ErrorCode | undefined;
  status?: number | undefined;
  retryable?: boolean | undefined;
  retryAfterMs?: number | undefined;
  bodyText?: string | undefined;
  /** Which limit the provider reported; the goal loop waits for `resetAt` instead of hammering. */
  limitKind?: LimitKind | undefined;
  resetAt?: number | undefined;
  /** The provider's own error code, for example `context_length_exceeded`. */
  providerCode?: string | undefined;
  cause?: unknown;
}

export class TransportError extends HarnessError {
  readonly reason: TransportErrorReason;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly bodyText: string;
  readonly limitKind: LimitKind | undefined;
  readonly resetAt: number | undefined;
  readonly providerCode: string | undefined;

  constructor(message: string, options: TransportErrorOptions) {
    super(
      options.code ?? (options.reason === "proxy" ? "invalid_input" : "provider_failed"),
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "TransportError";
    this.reason = options.reason;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.bodyText = options.bodyText ?? "";
    this.limitKind = options.limitKind;
    this.resetAt = options.resetAt;
    this.providerCode = options.providerCode;
  }
}

export interface PreparedHeaders {
  headers: Record<string, string>;
  redacted: Record<string, string>;
}

export interface ProviderFetchOptions {
  proxy?: string | URL | undefined;
  timeoutMs?: number | undefined;
  idleTimeoutMs?: number | undefined;
  headers?: Record<string, string> | undefined;
  tls?: BunFetchRequestInit["tls"];
}

export type ProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function isSecretHeader(name: string): boolean {
  return SECRET_HEADER_NAMES.has(name.trim().toLowerCase());
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, name) => {
      record[name] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    const record: Record<string, string> = {};
    for (const [name, value] of headers) record[name] = value;
    return record;
  }
  return { ...headers };
}

export function prepareHeaders(...sources: Array<HeadersInit | undefined>): PreparedHeaders {
  const headers: Record<string, string> = {};
  const names = new Map<string, string>();

  for (const source of sources) {
    for (const [name, value] of Object.entries(headersToRecord(source))) {
      const key = name.toLowerCase();
      const previous = names.get(key);
      if (previous !== undefined) delete headers[previous];
      names.set(key, name);
      headers[name] = value;
    }
  }

  const redacted: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    redacted[name] = isSecretHeader(name) ? "[redacted]" : value;
  }

  return { headers, redacted };
}

function validateProxy(proxy: string | URL): string | URL {
  const raw = typeof proxy === "string" ? proxy.trim() : proxy;
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : new URL(raw.href);
  } catch {
    throw new TransportError("Некорректный URL прокси. Укажите адрес вида http://host:port.", {
      reason: "proxy",
    });
  }

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new TransportError(
      `Прокси-схема "${scheme}" не поддерживается. Bun 1.4 поддерживает только http:// и https:// прокси.`,
      { reason: "proxy" },
    );
  }

  return raw;
}

function secretValues(headers: Record<string, string>): string[] {
  const values = new Set<string>();
  for (const [name, raw] of Object.entries(headers)) {
    if (!isSecretHeader(name)) continue;
    const value = raw.trim();
    if (!value) continue;
    values.add(value);
    const space = value.indexOf(" ");
    if (space > 0) {
      const token = value.slice(space + 1).trim();
      if (token) values.add(token);
    }
  }
  return [...values].sort((left, right) => right.length - left.length);
}

function sanitize(text: string, secrets: string[]): string {
  let output = text;
  for (const secret of secrets) output = output.split(secret).join("[redacted]");
  return redact(output).slice(0, BODY_LIMIT);
}

export function sanitizeBody(text: string, headers?: HeadersInit): string {
  return sanitize(text, secretValues(headersToRecord(headers)));
}

async function errorBody(response: Response, secrets: string[]): Promise<string> {
  try {
    return sanitize(await response.text(), secrets);
  } catch {
    return "";
  }
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const seconds = Number(trimmed);
  if (trimmed.length > 0 && Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

function idleResponse(response: Response, idleMs: number): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new TransportError(`Провайдер не присылал данные ${idleMs} мс.`, {
                reason: "timeout",
                retryable: true,
              }),
            ),
          idleMs,
        );
      });
      try {
        const result = await Promise.race([reader.read(), timeout]);
        clearTimeout(timer);
        timer = undefined;
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        clearTimeout(timer);
        timer = undefined;
        await reader.cancel().catch(() => undefined);
        controller.error(error);
      }
    },
    cancel(reason) {
      clearTimeout(timer);
      timer = undefined;
      return reader.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export interface CachedSource<T> {
  name: string;
  url: string;
  accept: string;
  read(response: Response): Promise<unknown>;
  parse(raw: unknown): T;
  empty(value: T): boolean;
  cacheValue?: "raw" | "value";
}

export interface CachedSourceOptions {
  cachePath: string;
  ttlMs: number;
  url?: string;
  fetch?: typeof fetch;
  now?: () => number;
  force?: boolean;
}

const sourceMemory = new Map<string, { value: unknown; at: number }>();
const sourceErrors = new Map<string, string>();

export function resetCachedSources(): void {
  sourceMemory.clear();
  sourceErrors.clear();
}

export function cachedSourceError(name: string): string | undefined {
  return sourceErrors.get(name);
}

export function allCachedSourceErrors(): string | undefined {
  const values = [...sourceErrors.values()];
  return values.length > 0 ? values.join("; ") : undefined;
}

function sourceError(name: string, message: string): string {
  return `catalog ${name}: ${message}`;
}

async function readCacheFile(path: string): Promise<{ raw: unknown; mtimeMs: number } | undefined> {
  try {
    const info = await stat(path);
    return { raw: await Bun.file(path).json(), mtimeMs: info.mtimeMs };
  } catch {
    return undefined;
  }
}

async function writeCacheFile(path: string, value: unknown): Promise<void> {
  try {
    await atomicWrite(path, JSON.stringify(value));
  } catch {}
}

export async function loadCachedSource<T>(
  spec: CachedSource<T>,
  options: CachedSourceOptions,
): Promise<T | undefined> {
  const now = options.now?.() ?? Date.now();
  const memo = sourceMemory.get(spec.name);
  if (!options.force && memo && now - memo.at <= options.ttlMs) return memo.value as T;

  const cache = await readCacheFile(options.cachePath);
  const fresh = cache !== undefined && now - cache.mtimeMs <= options.ttlMs;
  let value: T | undefined;
  let error: string | undefined;
  let fetched: unknown;
  let network = false;

  if (!options.force && fresh && cache) {
    try {
      value = spec.parse(cache.raw);
    } catch (cause) {
      error = sourceError(spec.name, cause instanceof Error ? cause.message : String(cause));
    }
  }

  if (value === undefined) {
    network = true;
    try {
      const response = await (options.fetch ?? fetch)(options.url ?? spec.url, {
        headers: { accept: spec.accept },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) fetched = await spec.read(response);
      else error = sourceError(spec.name, `HTTP ${response.status}`);
    } catch (cause) {
      error = sourceError(spec.name, cause instanceof Error ? cause.message : String(cause));
    }
    if (fetched !== undefined) {
      try {
        const parsed = spec.parse(fetched);
        if (spec.empty(parsed)) error ??= sourceError(spec.name, "response contained no models");
        else {
          value = parsed;
          error = undefined;
        }
      } catch (cause) {
        error = sourceError(spec.name, cause instanceof Error ? cause.message : String(cause));
      }
    }
  }

  if (value === undefined && cache) {
    try {
      const parsed = spec.parse(cache.raw);
      if (!spec.empty(parsed)) value = parsed;
    } catch {}
  }

  if (value !== undefined) {
    sourceMemory.set(spec.name, { value, at: network ? now : (cache?.mtimeMs ?? now) });
    if (network && fetched !== undefined && error === undefined && !spec.empty(value)) {
      await writeCacheFile(options.cachePath, spec.cacheValue === "value" ? value : fetched);
    }
  }
  if (error) sourceErrors.set(spec.name, error);
  else sourceErrors.delete(spec.name);
  return value;
}

export function createProviderFetch(options: ProviderFetchOptions = {}): ProviderFetch {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TransportError("Таймаут должен быть положительным числом миллисекунд.", {
      reason: "timeout",
    });
  }
  const idleTimeoutMs = options.idleTimeoutMs ?? 0;
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0) {
    throw new TransportError("Idle-таймаут должен быть неотрицательным числом миллисекунд.", {
      reason: "timeout",
    });
  }

  const proxy = options.proxy === undefined ? undefined : validateProxy(options.proxy);
  const baseHeaders = prepareHeaders(options.headers).headers;
  const baseSecrets = secretValues(baseHeaders);

  return async function providerFetch(input, init) {
    const requestHeaders = prepareHeaders(
      baseHeaders,
      input instanceof Request ? input.headers : undefined,
      init?.headers,
    ).headers;
    const secrets = [...new Set([...baseSecrets, ...secretValues(requestHeaders)])];
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, controller.signal])
      : controller.signal;
    const redirect = init?.redirect ?? (input instanceof Request ? input.redirect : "follow");

    try {
      const response = await fetch(input, {
        ...init,
        headers: requestHeaders,
        redirect,
        signal,
        ...(proxy === undefined ? {} : { proxy }),
        ...(options.tls === undefined ? {} : { tls: options.tls }),
      });

      if (response.ok || REDIRECT_STATUS.has(response.status)) {
        return idleTimeoutMs > 0 ? idleResponse(response, idleTimeoutMs) : response;
      }

      const bodyText = await errorBody(response, secrets);
      throw new TransportError(`Провайдер вернул HTTP ${response.status}.`, {
        reason: "http",
        status: response.status,
        retryable: RETRYABLE_STATUS.has(response.status),
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
        bodyText,
      });
    } catch (error) {
      if (error instanceof TransportError) throw error;
      if (timedOut) {
        throw new TransportError(`Провайдер не ответил за ${timeoutMs} мс.`, {
          reason: "timeout",
          retryable: true,
          cause: error,
        });
      }
      if (callerSignal?.aborted) {
        throw new TransportError("Запрос к провайдеру отменён.", {
          reason: "aborted",
          cause: error,
        });
      }
      const detail = sanitize(error instanceof Error ? error.message : String(error), secrets);
      if (proxy !== undefined) {
        throw new TransportError(`Не удалось подключиться через прокси: ${detail}`, {
          reason: "proxy",
          code: "provider_failed",
          retryable: false,
          cause: error,
        });
      }
      throw new TransportError(`Не удалось связаться с провайдером: ${detail}`, {
        reason: "network",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
