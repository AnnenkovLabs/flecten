import { z } from "zod";
import { parseSse } from "../providers/sse";
import { redact } from "../util/redact";
import { readMcpMessage } from "./message-reader";
import { authorizationHeaders, type TokenProvider } from "./oauth";

export const DEFAULT_MCP_PROTOCOL_VERSION = "2026-07-28";

const InitializeResultSchema = z.object({
  protocolVersion: z.string().min(1),
  capabilities: z.record(z.string(), z.unknown()).default({}),
  serverInfo: z.object({ name: z.string(), version: z.string() }).optional(),
  instructions: z.string().optional(),
});

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

export interface McpNotification {
  method: string;
  params?: unknown;
}

export interface McpRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface McpRequestClient {
  request<T = unknown>(method: string, params?: unknown, options?: McpRequestOptions): Promise<T>;
  onNotification(handler: (notification: McpNotification) => void): () => void;
}

export interface McpRetryPolicy {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface StreamableHttpClientOptions {
  url: string;
  headers?: Record<string, string>;
  tokenProvider?: TokenProvider;
  timeoutMs?: number;
  protocolVersion?: string;
  clientInfo?: { name: string; version: string };
  retry?: McpRetryPolicy;
  onRequest?: (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;
}

export interface McpNegotiation {
  protocolVersion: string;
  sessionId?: string;
  serverInfo?: { name: string; version: string };
  instructions?: string;
}

interface RetrySettings {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface McpHttpErrorOptions {
  status?: number;
  code?: number;
  data?: unknown;
  cause?: unknown;
}

export class McpHttpError extends Error {
  readonly status: number | undefined;
  readonly code: number | undefined;
  readonly data: unknown;

  constructor(message: string, options: McpHttpErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "McpHttpError";
    this.status = options.status;
    this.code = options.code;
    this.data = options.data;
  }
}

export class McpTimeoutError extends McpHttpError {
  constructor(message: string, options: McpHttpErrorOptions = {}) {
    super(message, options);
    this.name = "McpTimeoutError";
  }
}

function retrySettings(policy: McpRetryPolicy | undefined): RetrySettings {
  return {
    attempts: Math.max(1, policy?.attempts ?? 3),
    baseDelayMs: Math.max(1, policy?.baseDelayMs ?? 250),
    maxDelayMs: Math.max(1, policy?.maxDelayMs ?? 4000),
  };
}

function backoff(attempt: number, settings: RetrySettings): number {
  return Math.min(settings.baseDelayMs * 2 ** attempt, settings.maxDelayMs);
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const done = (): void => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRetryable(error: unknown): boolean {
  if (error instanceof McpTimeoutError) return true;
  if (error instanceof McpHttpError) {
    return error.status !== undefined && RETRYABLE_STATUS.has(error.status);
  }
  return error instanceof TypeError;
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    normalized[name.toLowerCase()] = value;
  }
  return normalized;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// ponytail: notifications arrive on POST SSE responses; add a standalone GET stream
// if a server emits list_changed out of band.
export class StreamableHttpClient implements McpRequestClient {
  readonly #url: string;
  readonly #customHeaders: Record<string, string>;
  readonly #tokenProvider: TokenProvider | undefined;
  readonly #timeoutMs: number;
  readonly #preferredProtocolVersion: string;
  readonly #clientInfo: { name: string; version: string };
  readonly #retry: RetrySettings;
  readonly #onRequest: StreamableHttpClientOptions["onRequest"];
  readonly #listeners = new Set<(notification: McpNotification) => void>();
  readonly #active = new Set<AbortController>();

  #nextRequestId = 1;
  #sessionId: string | undefined;
  #negotiatedProtocolVersion: string | undefined;
  #instructions: string | undefined;
  #connected = false;
  #closed = false;

  constructor(options: StreamableHttpClientOptions) {
    this.#url = options.url;
    this.#customHeaders = normalizeHeaders(options.headers);
    this.#tokenProvider = options.tokenProvider;
    this.#timeoutMs = Math.max(1, options.timeoutMs ?? 60_000);
    this.#preferredProtocolVersion = options.protocolVersion ?? DEFAULT_MCP_PROTOCOL_VERSION;
    this.#clientInfo = options.clientInfo ?? { name: "flecten", version: "0.1.0" };
    this.#retry = retrySettings(options.retry);
    this.#onRequest = options.onRequest;
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  get protocolVersion(): string | undefined {
    return this.#negotiatedProtocolVersion;
  }

  get instructions(): string | undefined {
    return this.#instructions;
  }

  get connected(): boolean {
    return this.#connected;
  }

  async connect(signal?: AbortSignal): Promise<McpNegotiation> {
    this.#assertOpen();
    this.#connected = false;
    let lastError: unknown;

    for (let attempt = 0; attempt < this.#retry.attempts; attempt += 1) {
      if (signal?.aborted) throw abortReason(signal);
      try {
        const negotiation = await this.#handshake(signal);
        this.#connected = true;
        return negotiation;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
        if (!isRetryable(error) || attempt === this.#retry.attempts - 1) throw error;
        await sleep(backoff(attempt, this.#retry), signal);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async reconnect(signal?: AbortSignal): Promise<McpNegotiation> {
    this.#assertOpen();
    this.#connected = false;
    this.#sessionId = undefined;
    this.#negotiatedProtocolVersion = undefined;
    return this.connect(signal);
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    options: McpRequestOptions = {},
  ): Promise<T> {
    this.#assertOpen();
    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    const message: Record<string, unknown> = { jsonrpc: "2.0", id, method };
    if (params !== undefined) message.params = params;
    return (await this.#send(message, id, options)) as T;
  }

  onNotification(handler: (notification: McpNotification) => void): () => void {
    this.#listeners.add(handler);
    return () => {
      this.#listeners.delete(handler);
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#connected = false;
    const reason = new DOMException("MCP client closed", "AbortError");
    for (const controller of this.#active) controller.abort(reason);
    this.#active.clear();
    this.#listeners.clear();
  }

  async #handshake(signal: AbortSignal | undefined): Promise<McpNegotiation> {
    this.#sessionId = undefined;
    this.#negotiatedProtocolVersion = undefined;
    this.#instructions = undefined;
    const result = await this.request(
      "initialize",
      {
        protocolVersion: this.#preferredProtocolVersion,
        capabilities: this.#onRequest ? { elicitation: { form: {}, url: {} } } : {},
        clientInfo: this.#clientInfo,
      },
      signal === undefined ? {} : { signal },
    );
    const parsed = InitializeResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new McpHttpError("MCP server returned an invalid initialize result", {
        cause: parsed.error,
      });
    }
    this.#negotiatedProtocolVersion = parsed.data.protocolVersion;
    this.#instructions = parsed.data.instructions;
    await this.#notify("notifications/initialized", undefined, signal);
    return {
      protocolVersion: parsed.data.protocolVersion,
      ...(this.#sessionId === undefined ? {} : { sessionId: this.#sessionId }),
      ...(parsed.data.serverInfo === undefined ? {} : { serverInfo: parsed.data.serverInfo }),
      ...(parsed.data.instructions === undefined ? {} : { instructions: parsed.data.instructions }),
    };
  }

  async #notify(method: string, params: unknown, signal: AbortSignal | undefined): Promise<void> {
    const message: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) message.params = params;
    await this.#send(message, undefined, signal === undefined ? {} : { signal });
  }

  async #send(
    message: Record<string, unknown>,
    id: number | undefined,
    options: McpRequestOptions,
  ): Promise<unknown> {
    let token = await this.#tokenProvider?.getToken();
    let refreshed = false;

    while (true) {
      try {
        return await this.#withTimeout(
          options.timeoutMs ?? this.#timeoutMs,
          options.signal,
          (signal) => this.#post(message, id, token, signal),
        );
      } catch (error) {
        if (refreshed || !(error instanceof McpHttpError) || error.status !== 401) throw error;
        const next = await this.#tokenProvider?.refresh?.();
        if (next === undefined) throw error;
        refreshed = true;
        token = next;
      }
    }
  }

  async #post(
    message: Record<string, unknown>,
    id: number | undefined,
    token: string | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(this.#url, {
      method: "POST",
      headers: {
        ...this.#baseHeaders(token),
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(message),
      signal,
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new McpHttpError("MCP redirect refused; configure the server's final URL", {
        status: response.status,
      });
    }
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId !== null) this.#sessionId = sessionId;

    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      throw new McpHttpError("MCP server rejected the access token", { status: 401 });
    }
    if (!response.ok) {
      let detail = "";
      try {
        detail = redact((await response.text()).slice(0, 2000)).trim();
      } catch {
        detail = "";
      }
      throw new McpHttpError(`MCP HTTP ${response.status}${detail ? `: ${detail}` : ""}`, {
        status: response.status,
      });
    }
    if (id === undefined || response.status === 202 || response.status === 204) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    return this.#readResponse(response, id, signal);
  }

  async #readResponse(response: Response, id: number, signal: AbortSignal): Promise<unknown> {
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("text/event-stream")) {
      if (!response.body) throw new McpHttpError("MCP server returned an empty SSE stream");
      let matched = false;
      let value: unknown;
      try {
        for await (const event of parseSse(response.body, signal)) {
          const message = parseJson(event.data);
          if (message === undefined) continue;
          const outcome = await this.#handleMessage(message, id, signal);
          if (!outcome.matched) continue;
          matched = true;
          value = outcome.value;
          break;
        }
      } finally {
        await response.body.cancel().catch(() => undefined);
      }
      if (matched) return value;
      throw new McpHttpError("MCP SSE stream ended without a matching JSON-RPC response");
    }

    const text = await response.text();
    if (text.trim().length === 0) {
      throw new McpHttpError("MCP server returned an empty JSON-RPC response");
    }
    const parsed = parseJson(text);
    if (parsed === undefined) throw new McpHttpError("MCP server returned invalid JSON");
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      const outcome = await this.#handleMessage(candidate, id, signal);
      if (outcome.matched) return outcome.value;
    }
    throw new McpHttpError(`MCP server response did not include request id ${id}`);
  }

  async #handleMessage(value: unknown, id: number, signal: AbortSignal) {
    return readMcpMessage(value, id, signal, {
      notification: (notification) => {
        for (const listener of this.#listeners) listener(notification);
      },
      ...(this.#onRequest ? { request: this.#onRequest } : {}),
      reply: async (message) => {
        await this.#send(message, undefined, { signal });
      },
      error: (message, details) => new McpHttpError(message, details),
    });
  }

  #baseHeaders(token: string | undefined): Record<string, string> {
    const headers = { ...this.#customHeaders };
    if (this.#sessionId !== undefined) headers["mcp-session-id"] = this.#sessionId;
    if (this.#negotiatedProtocolVersion !== undefined) {
      headers["mcp-protocol-version"] = this.#negotiatedProtocolVersion;
    }
    return Object.assign(headers, authorizationHeaders(token));
  }

  async #withTimeout<T>(
    timeoutMs: number,
    signal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(abortReason(signal));
    if (signal?.aborted) controller.abort(abortReason(signal));
    else signal?.addEventListener("abort", onAbort, { once: true });
    this.#active.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("MCP request timed out", "TimeoutError"));
    }, timeoutMs);

    try {
      return await run(controller.signal);
    } catch (error) {
      if (timedOut) {
        throw new McpTimeoutError(`MCP request timed out after ${timeoutMs}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.#active.delete(controller);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new McpHttpError("MCP client is closed");
  }
}
