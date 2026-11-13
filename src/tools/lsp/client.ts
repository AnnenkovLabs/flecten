import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { childEnv } from "./config";

export interface LspServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  envAllowlist?: string[];
  requestTimeoutMs?: number;
  diagnosticsTimeoutMs?: number;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
}

export interface LspRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 1_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;
const SHUTDOWN_GRACE_MS = 1_500;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function settleQuietly(action: () => unknown): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
}

function ignoreWrite(result: number | Promise<number>): void {
  if (typeof result !== "number") void result.catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePosition(value: unknown): LspPosition | undefined {
  if (!isRecord(value)) return undefined;
  const { line, character } = value;
  if (typeof line !== "number" || !Number.isInteger(line) || line < 0) return undefined;
  if (typeof character !== "number" || !Number.isInteger(character) || character < 0) {
    return undefined;
  }
  return { line, character };
}

function parseRange(value: unknown): LspRange | undefined {
  if (!isRecord(value)) return undefined;
  const start = parsePosition(value.start);
  const end = parsePosition(value.end);
  return start && end ? { start, end } : undefined;
}

function parseDiagnostic(value: unknown): LspDiagnostic | undefined {
  if (!isRecord(value)) return undefined;
  const range = parseRange(value.range);
  if (!range || typeof value.message !== "string") return undefined;
  const severity =
    typeof value.severity === "number" &&
    Number.isInteger(value.severity) &&
    value.severity >= 1 &&
    value.severity <= 4
      ? value.severity
      : undefined;
  const source = typeof value.source === "string" ? value.source : undefined;
  const code =
    typeof value.code === "string" || typeof value.code === "number" ? value.code : undefined;
  return {
    range,
    message: value.message,
    ...(severity !== undefined ? { severity } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(code !== undefined ? { code } : {}),
  };
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length === 0) return right;
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left);
  combined.set(right, left.length);
  return combined;
}

function headerEnd(buffer: Uint8Array): number {
  for (let index = 0; index + 3 < buffer.length; index += 1) {
    if (
      buffer[index] === 13 &&
      buffer[index + 1] === 10 &&
      buffer[index + 2] === 13 &&
      buffer[index + 3] === 10
    ) {
      return index;
    }
  }
  return -1;
}

function contentLength(header: string): number {
  let length = -1;
  for (const line of header.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() !== "content-length") continue;
    const value = Number(line.slice(colon + 1).trim());
    length = Number.isInteger(value) && value >= 0 ? value : -1;
  }
  return length;
}

export class LspClient {
  readonly #config: LspServerConfig;
  readonly #root: string;
  readonly #requestTimeoutMs: number;
  readonly #diagnosticsTimeoutMs: number;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #diagnostics = new Map<string, LspDiagnostic[]>();
  readonly #diagnosticWaiters = new Map<string, Set<(error?: Error) => void>>();
  #proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  #buffer: Uint8Array = new Uint8Array(0);
  #stderrTail = "";
  #nextId = 1;
  #exited = false;

  constructor(config: LspServerConfig, root: string) {
    this.#config = config;
    this.#root = root;
    this.#requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#diagnosticsTimeoutMs = config.diagnosticsTimeoutMs ?? DEFAULT_DIAGNOSTICS_TIMEOUT_MS;
  }

  get running(): boolean {
    return this.#proc !== null;
  }

  #ensureStarted(): Bun.Subprocess<"pipe", "pipe", "pipe"> {
    if (this.#proc) return this.#proc;
    if (this.#exited) throw new Error("Language server is not running");
    const proc = Bun.spawn([this.#config.command, ...(this.#config.args ?? [])], {
      cwd: this.#config.cwd ?? this.#root,
      env: childEnv(this.#config.env, this.#config.envAllowlist),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.#proc = proc;
    void this.#readLoop(proc.stdout);
    void this.#drainStderr(proc.stderr);
    void proc.exited.then((code) => {
      this.#exited = true;
      if (this.#proc === proc) this.#proc = null;
      const detail = this.#stderrTail.trim();
      const error = new Error(
        `Language server exited with code ${code}${detail ? `: ${detail}` : ""}`,
      );
      this.#failAll(error);
      this.#resolveAllDiagnosticWaiters(error);
    });
    return proc;
  }

  #send(message: object): void {
    const proc = this.#proc;
    if (!proc) throw new Error("Language server is not running");
    const body = JSON.stringify(message);
    const frame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
    ignoreWrite(proc.stdin.write(frame));
    ignoreWrite(proc.stdin.flush());
  }

  async #readLoop(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.#buffer = concatBytes(this.#buffer, value);
        this.#parseFrames();
      }
    } catch (error) {
      this.#failAll(asError(error));
      this.#proc?.kill("SIGKILL");
    } finally {
      reader.releaseLock();
    }
  }

  async #drainStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of stream) {
        const text = decoder.decode(chunk, { stream: true });
        this.#stderrTail = (this.#stderrTail + text).slice(-MAX_STDERR_BYTES);
      }
      this.#stderrTail = (this.#stderrTail + decoder.decode()).slice(-MAX_STDERR_BYTES);
    } catch {
      return;
    }
  }

  #parseFrames(): void {
    for (;;) {
      const end = headerEnd(this.#buffer);
      if (end < 0) {
        if (this.#buffer.length > MAX_HEADER_BYTES) {
          throw new Error("LSP header exceeds the size limit");
        }
        return;
      }
      const header = new TextDecoder().decode(this.#buffer.subarray(0, end));
      const length = contentLength(header);
      if (length < 0 || length > MAX_MESSAGE_BYTES) {
        throw new Error("LSP message has an invalid Content-Length");
      }
      const total = end + 4 + length;
      if (this.#buffer.length < total) return;
      const body = new TextDecoder().decode(this.#buffer.subarray(end + 4, total));
      this.#buffer = this.#buffer.subarray(total);
      this.#dispatch(JSON.parse(body) as JsonRpcMessage);
    }
  }

  #dispatch(message: JsonRpcMessage): void {
    if (typeof message.method === "string") {
      if (message.id !== undefined) {
        this.#handleServerRequest(message.id, message.method, message.params);
        return;
      }
      if (message.method === "textDocument/publishDiagnostics") {
        this.#handleDiagnostics(message.params);
      }
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    if (message.error) {
      pending.reject(new Error(`LSP error ${message.error.code}: ${message.error.message}`));
      return;
    }
    pending.resolve(message.result);
  }

  #handleServerRequest(id: number | string, method: string, params: unknown): void {
    if (method === "workspace/configuration") {
      const items = isRecord(params) && Array.isArray(params.items) ? params.items : [];
      this.#send({ jsonrpc: "2.0", id, result: items.map(() => null) });
      return;
    }
    if (method === "client/registerCapability" || method === "window/workDoneProgress/create") {
      this.#send({ jsonrpc: "2.0", id, result: null });
      return;
    }
    this.#send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not supported by client: ${method}` },
    });
  }

  #handleDiagnostics(params: unknown): void {
    if (!isRecord(params) || typeof params.uri !== "string" || !Array.isArray(params.diagnostics)) {
      return;
    }
    const diagnostics: LspDiagnostic[] = [];
    for (const item of params.diagnostics) {
      const diagnostic = parseDiagnostic(item);
      if (diagnostic) diagnostics.push(diagnostic);
    }
    this.#diagnostics.set(params.uri, diagnostics);
    this.#resolveDiagnosticWaiters(params.uri);
  }

  #resolveDiagnosticWaiters(uri: string): void {
    const waiters = this.#diagnosticWaiters.get(uri);
    if (!waiters) return;
    this.#diagnosticWaiters.delete(uri);
    for (const waiter of [...waiters]) waiter();
  }

  #resolveAllDiagnosticWaiters(error: Error): void {
    const all = [...this.#diagnosticWaiters.values()];
    this.#diagnosticWaiters.clear();
    for (const waiters of all) {
      for (const waiter of [...waiters]) waiter(error);
    }
  }

  #failAll(error: Error): void {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const request of pending) request.reject(error);
  }

  #cancel(id: number): void {
    void settleQuietly(() =>
      this.#send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } }),
    );
  }

  request<T>(method: string, params: unknown, options: LspRequestOptions = {}): Promise<T> {
    try {
      this.#ensureStarted();
    } catch (error) {
      return Promise.reject(asError(error));
    }

    const id = this.#nextId;
    this.#nextId += 1;
    const timeoutMs = options.timeoutMs ?? this.#requestTimeoutMs;
    const signal = options.signal;

    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const settle = (action: () => void) => {
        this.#pending.delete(id);
        cleanup();
        action();
      };
      const onAbort = () => {
        settle(() => {
          this.#cancel(id);
          reject(new Error(`LSP request cancelled: ${method}`));
        });
      };

      timer = setTimeout(() => {
        settle(() => {
          this.#cancel(id);
          reject(new Error(`LSP request timed out after ${timeoutMs}ms: ${method}`));
        });
      }, timeoutMs);

      this.#pending.set(id, {
        resolve: (value) => settle(() => resolve(value as T)),
        reject: (error) => settle(() => reject(error)),
      });

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        this.#send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.#pending.delete(id);
        cleanup();
        reject(asError(error));
      }
    });
  }

  async initialize(options: LspRequestOptions = {}): Promise<unknown> {
    const rootUri = pathToFileURL(this.#root).href;
    const result = await this.request(
      "initialize",
      {
        processId: process.pid,
        clientInfo: { name: "flecten" },
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: basename(this.#root) }],
        capabilities: {
          workspace: { workspaceFolders: true, configuration: true },
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: false },
            publishDiagnostics: {},
            definition: { linkSupport: true },
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          },
        },
      },
      options,
    );
    this.initialized();
    return result;
  }

  initialized(): void {
    this.#send({ jsonrpc: "2.0", method: "initialized", params: {} });
  }

  didOpen(uri: string, languageId: string, text: string): void {
    this.#send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId, version: 1, text } },
    });
  }

  // ponytail: push diagnostics only and the first publish wins. Add textDocument/diagnostic pull and a debounce if servers send partial updates.
  waitForDiagnostics(uri: string, options: LspRequestOptions = {}): Promise<LspDiagnostic[]> {
    const cached = this.#diagnostics.get(uri);
    if (cached) return Promise.resolve(cached);
    if (!this.#proc) return Promise.reject(new Error("Language server is not running"));

    const timeoutMs = options.timeoutMs ?? this.#diagnosticsTimeoutMs;
    const signal = options.signal;

    return new Promise<LspDiagnostic[]>((resolve, reject) => {
      const waiters = this.#diagnosticWaiters.get(uri) ?? new Set<(error?: Error) => void>();
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        waiters.delete(onNotify);
        if (waiters.size === 0) this.#diagnosticWaiters.delete(uri);
      };
      const finish = (error?: Error) => {
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        resolve(this.#diagnostics.get(uri) ?? []);
      };
      const onNotify = (error?: Error) => finish(error);
      const onAbort = () => finish(new Error(`LSP diagnostics wait cancelled: ${uri}`));

      timer = setTimeout(() => finish(), timeoutMs);
      waiters.add(onNotify);
      this.#diagnosticWaiters.set(uri, waiters);

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async shutdown(): Promise<void> {
    const proc = this.#proc;
    if (!proc) return;
    await settleQuietly(() => this.request("shutdown", null, { timeoutMs: SHUTDOWN_TIMEOUT_MS }));
    void settleQuietly(() => this.#send({ jsonrpc: "2.0", method: "exit", params: null }));
    void settleQuietly(() => proc.stdin.end());
    const timer = setTimeout(() => proc.kill("SIGKILL"), SHUTDOWN_GRACE_MS);
    await proc.exited;
    clearTimeout(timer);
    if (this.#proc === proc) this.#proc = null;
    this.#failAll(new Error("Language server shut down"));
  }
}
