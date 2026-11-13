import type { FailoverConfig, ProviderConfig } from "../config/schema";
import { HarnessError } from "../errors";
import { retryDelayMs } from "./http";
import { StreamError } from "./sse";
import { TransportError } from "./transport";
import type { ModelEvent, ModelProvider, ModelRequest } from "./types";

export type ProviderFailureKind =
  | "rate_limit"
  | "quota"
  | "auth"
  | "context"
  | "server"
  | "network"
  | "timeout"
  | "aborted"
  | "proxy"
  | "invalid"
  | "unknown";

const QUOTA_CODES = new Set([
  "insufficient_quota",
  "quota_exceeded",
  "quota_5h",
  "billing_hard_limit_reached",
  "billing_not_active",
  "usage_limit_reached",
  "resource_exhausted",
]);
const CONTEXT_CODES = new Set([
  "context_length_exceeded",
  "context_window_exceeded",
  "token_limit_exceeded",
  "max_tokens_exceeded",
  "request_too_large",
  "string_above_max_length",
]);
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EPIPE",
]);

export interface ProviderFailureInit {
  status?: number | undefined;
  retryable?: boolean | undefined;
  retryAfterMs?: number | undefined;
  cause?: unknown;
}

export class ProviderFailure extends HarnessError {
  readonly kind: ProviderFailureKind;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(kind: ProviderFailureKind, message: string, init: ProviderFailureInit = {}) {
    super(
      kind === "context"
        ? "context_overflow"
        : kind === "aborted"
          ? "cancelled"
          : kind === "invalid" || kind === "proxy"
            ? "invalid_input"
            : "provider_failed",
      message,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.name = "ProviderFailure";
    this.kind = kind;
    this.status = init.status;
    this.retryable = init.retryable ?? defaultRetryable(kind);
    this.retryAfterMs = init.retryAfterMs;
  }

  static from(error: unknown): ProviderFailure {
    if (error instanceof ProviderFailure) return error;
    if (error instanceof TransportError) {
      const kind = transportKind(error);
      return new ProviderFailure(kind, error.message, {
        ...(error.status === undefined ? {} : { status: error.status }),
        retryable: defaultRetryable(kind) && error.retryable,
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
        cause: error,
      });
    }
    if (error instanceof StreamError) {
      const kind: ProviderFailureKind =
        error.kind === "rate_limit"
          ? "rate_limit"
          : error.kind === "server"
            ? "server"
            : error.kind === "network"
              ? "network"
              : "unknown";
      return new ProviderFailure(kind, error.message, {
        retryable: error.retryable,
        cause: error,
      });
    }
    if (error instanceof HarnessError) {
      const kind: ProviderFailureKind =
        error.code === "context_overflow"
          ? "context"
          : error.code === "cancelled"
            ? "aborted"
            : "unknown";
      return new ProviderFailure(kind, error.message, { cause: error });
    }
    if (isRecord(error) && error.name === "AbortError") {
      return new ProviderFailure("aborted", "provider request aborted", { cause: error });
    }
    if (isRecord(error)) {
      const status = numberValue(error.status) ?? numberValue(error.statusCode);
      const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
      if (NETWORK_CODES.has(code)) {
        return new ProviderFailure("network", messageOf(error), { cause: error });
      }
      if (status !== undefined) {
        const kind = classifyStatusKind(status, "");
        const retryAfterMs = numberValue(error.retryAfterMs);
        return new ProviderFailure(kind, messageOf(error), {
          status,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          cause: error,
        });
      }
    }
    return new ProviderFailure("unknown", error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
}

function defaultRetryable(kind: ProviderFailureKind): boolean {
  return kind === "rate_limit" || kind === "server" || kind === "network" || kind === "timeout";
}

function transportKind(error: TransportError): ProviderFailureKind {
  if (error.reason === "aborted") return "aborted";
  if (error.reason === "proxy") return "proxy";
  if (error.reason === "timeout") return "timeout";
  if (error.reason === "network") return "network";
  return classifyStatusKind(error.status, error.bodyText);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function messageOf(error: Record<string, unknown>): string {
  return typeof error.message === "string" ? error.message : "provider request failed";
}

function collectCodes(value: unknown, output: string[], depth = 0): void {
  if (depth > 4) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectCodes(entry, output, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const key of ["code", "type", "status"]) {
    const entry = value[key];
    if (typeof entry === "string") output.push(entry.toLowerCase());
  }
  for (const key of ["error", "details", "response"]) {
    collectCodes(value[key], output, depth + 1);
  }
}

export function structuredErrorCodes(bodyText: string): string[] {
  if (!bodyText) return [];
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    const output: string[] = [];
    collectCodes(parsed, output);
    return output;
  } catch {
    return [];
  }
}

export function classifyStatusKind(status: number | undefined, bodyText = ""): ProviderFailureKind {
  const codes = structuredErrorCodes(bodyText);
  if (codes.some((code) => QUOTA_CODES.has(code)) || status === 402) return "quota";
  if (codes.some((code) => CONTEXT_CODES.has(code)) || status === 413) return "context";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status === 409 || status === 425) return "server";
  if (status !== undefined && status >= 500 && status <= 599) return "server";
  if (status === 400 || status === 404 || status === 422) return "invalid";
  return "unknown";
}

export interface FailoverTarget {
  provider: string;
  model: string;
}

export function targetKey(target: FailoverTarget): string {
  return `${target.provider}:${target.model}`;
}

export function buildFailoverPlan(
  primary: FailoverTarget,
  config?: FailoverConfig,
  providers: Record<string, Pick<ProviderConfig, "failoverModels">> = {},
): FailoverTarget[] {
  if (config?.enabled === false) return [primary];
  const plan: FailoverTarget[] = [];
  const seen = new Set<string>();
  const add = (target: FailoverTarget): void => {
    const key = targetKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    plan.push(target);
  };
  add(primary);
  for (const model of providers[primary.provider]?.failoverModels ?? []) {
    add({ provider: primary.provider, model });
  }
  for (const target of config?.providers ?? []) add(target);
  return plan;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  readonly failureThreshold: number;
  readonly cooldownMs: number;

  private readonly now: () => number;
  private readonly failures = new Map<string, number>();
  private readonly openUntil = new Map<string, number>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  state(target: FailoverTarget): CircuitState {
    const until = this.openUntil.get(targetKey(target));
    if (until === undefined) return "closed";
    return this.now() < until ? "open" : "half-open";
  }

  canAttempt(target: FailoverTarget): boolean {
    return this.state(target) !== "open";
  }

  recordSuccess(target: FailoverTarget): void {
    const key = targetKey(target);
    this.failures.delete(key);
    this.openUntil.delete(key);
  }

  recordFailure(target: FailoverTarget): CircuitState {
    const key = targetKey(target);
    const count = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, count);
    if (count >= this.failureThreshold) {
      this.openUntil.set(key, this.now() + this.cooldownMs);
      return "open";
    }
    return this.state(target);
  }
}

export interface FailoverAttempt {
  target: FailoverTarget;
  failure?: ProviderFailure;
  skipped?: boolean;
}

export interface FailoverBudget {
  remaining: number;
}

export interface FailoverStreamOptions {
  plan: FailoverTarget[];
  run(target: FailoverTarget): AsyncIterable<ModelEvent>;
  signal?: AbortSignal;
  config?: FailoverConfig;
  breaker?: CircuitBreaker;
  budget?: FailoverBudget;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  onAttempt?: (attempt: FailoverAttempt) => void;
  stopOn?: (failure: ProviderFailure) => boolean;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function* streamWithFailover(
  options: FailoverStreamOptions,
): AsyncGenerator<ModelEvent> {
  const config = options.config;
  const breaker =
    options.breaker ??
    new CircuitBreaker({
      ...(config?.failureThreshold === undefined
        ? {}
        : { failureThreshold: config.failureThreshold }),
      ...(config?.cooldownMs === undefined ? {} : { cooldownMs: config.cooldownMs }),
    });
  const sleep = options.sleep ?? wait;
  const random = options.random ?? Math.random;
  const budget = options.budget ?? { remaining: config?.retryBudget ?? 2 };
  let lastFailure: ProviderFailure | undefined;

  for (const target of options.plan) {
    if (options.signal?.aborted) {
      throw new ProviderFailure("aborted", "provider failover aborted");
    }
    if (!breaker.canAttempt(target)) {
      options.onAttempt?.({ target, skipped: true });
      continue;
    }
    let attempt = 0;
    while (true) {
      let emitted = false;
      try {
        for await (const event of options.run(target)) {
          emitted = true;
          yield event;
        }
        breaker.recordSuccess(target);
        return;
      } catch (error) {
        if (options.signal?.aborted) {
          throw new ProviderFailure("aborted", "provider failover aborted", { cause: error });
        }
        const failure = ProviderFailure.from(error);
        lastFailure = failure;
        if (failure.kind === "aborted") throw failure;
        breaker.recordFailure(target);
        options.onAttempt?.({ target, failure });
        if (emitted || options.stopOn?.(failure)) throw failure;
        const retry = failure.retryable && budget.remaining > 0 && breaker.canAttempt(target);
        if (!retry) break;
        budget.remaining -= 1;
        const delay = retryDelayMs(attempt, failure.retryAfterMs, random);
        await sleep(delay, options.signal);
        attempt += 1;
      }
    }
  }

  throw (
    lastFailure ??
    new ProviderFailure("unknown", "provider failover exhausted every target without a result")
  );
}

const STOP_FAILURE_KINDS = new Set<ProviderFailureKind>(["auth", "context", "invalid"]);

export interface FailoverModelProvider extends ModelProvider {
  readonly lastUsed: FailoverTarget | undefined;
}

export interface FailoverModelProviderOptions {
  primary: FailoverTarget;
  plan(primary: FailoverTarget): FailoverTarget[];
  resolve(target: FailoverTarget): ModelProvider;
  config?: FailoverConfig;
  onAttempt?: (attempt: FailoverAttempt) => void;
}

export function createFailoverProvider(
  options: FailoverModelProviderOptions,
): FailoverModelProvider {
  const config = options.config;
  const breaker = new CircuitBreaker({
    ...(config?.failureThreshold === undefined
      ? {}
      : { failureThreshold: config.failureThreshold }),
    ...(config?.cooldownMs === undefined ? {} : { cooldownMs: config.cooldownMs }),
  });
  const budget: FailoverBudget = { remaining: config?.retryBudget ?? 2 };
  let lastUsed: FailoverTarget | undefined;
  /** Why the request left the targets before the current one: a failure kind or an open circuit. */
  let routeReason: string | undefined;
  const onAttempt = (attempt: FailoverAttempt): void => {
    if (attempt.failure) routeReason = attempt.failure.kind;
    else if (attempt.skipped) routeReason ??= "circuit_open";
    options.onAttempt?.(attempt);
  };

  return {
    id: options.primary.provider,
    model: options.primary.model,
    get lastUsed(): FailoverTarget | undefined {
      return lastUsed;
    },
    async *stream(request: ModelRequest, signal: AbortSignal): AsyncGenerator<ModelEvent> {
      const primary: FailoverTarget = { provider: options.primary.provider, model: request.model };
      routeReason = undefined;
      async function* run(target: FailoverTarget): AsyncGenerator<ModelEvent> {
        const adapted =
          target.model === request.model ? request : { ...request, model: target.model };
        let announced = target.provider === primary.provider && target.model === primary.model;
        for await (const event of options.resolve(target).stream(adapted, signal)) {
          if (!announced) {
            // Announced with the first real output, so a fallback that fails silently stays retryable.
            announced = true;
            const reason = routeReason ?? "unknown";
            yield { type: "route", provider: target.provider, model: target.model, reason };
          }
          yield event;
        }
        lastUsed = target;
      }
      yield* streamWithFailover({
        plan: options.plan(primary),
        run,
        signal,
        ...(config === undefined ? {} : { config }),
        breaker,
        budget,
        stopOn: (failure) => STOP_FAILURE_KINDS.has(failure.kind),
        onAttempt,
      });
    },
  };
}
