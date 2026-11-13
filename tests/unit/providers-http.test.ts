import { afterEach, describe, expect, test } from "bun:test";
import { defaultConfig } from "../../src/config/defaults";
import { HarnessConfigSchema, ProviderConfigSchema } from "../../src/config/schema";
import { postStream, retryDelayMs } from "../../src/providers/http";
import {
  parseDurationMs,
  parseRateLimit,
  rateLimitDelayMs,
  rateLimitState,
} from "../../src/providers/rate-limit";
import { createProviderFetch, sanitizeBody, TransportError } from "../../src/providers/transport";
import { cleanupProviders, failureOf, serve, withFetch } from "../helpers/provider-hardening";

afterEach(cleanupProviders);

describe("provider http policy", () => {
  test("honours Retry-After dates and jittered exponential backoff", async () => {
    let calls = 0;
    const base = serve(() => {
      calls += 1;
      if (calls === 1) {
        return new Response("later", {
          status: 429,
          headers: { "retry-after": new Date(Date.now() - 60_000).toUTCString() },
        });
      }
      return new Response("ok");
    });
    const response = await postStream({
      url: base,
      headers: {},
      body: { ping: true },
      signal: new AbortController().signal,
      retries: 1,
      random: () => 0,
      sleep: async () => undefined,
    });
    expect(await response.text()).toBe("ok");
    expect(calls).toBe(2);

    expect(retryDelayMs(0, undefined, () => 0)).toBe(250);
    expect(retryDelayMs(0, undefined, () => 1)).toBe(500);
    expect(retryDelayMs(1, undefined, () => 0)).toBe(500);
    expect(retryDelayMs(6, undefined, () => 1)).toBe(8_000);
    expect(retryDelayMs(0, 1_500, () => 0)).toBe(1_500);
  });

  test("never retries auth failures or aborts", async () => {
    let calls = 0;
    const base = serve(() => {
      calls += 1;
      return new Response("no", { status: 401 });
    });
    const error = await failureOf(() =>
      postStream({
        url: base,
        headers: {},
        body: {},
        signal: new AbortController().signal,
        retries: 3,
        sleep: async () => undefined,
      }),
    );
    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).status).toBe(401);
    expect(calls).toBe(1);

    let abortedCalls = 0;
    const controller = new AbortController();
    const hanging = ((_input: string | URL | Request, init?: RequestInit) => {
      abortedCalls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    }) as typeof fetch;
    const pending = postStream({
      url: "https://example.com",
      headers: {},
      body: {},
      signal: controller.signal,
      retries: 3,
      fetch: hanging,
      sleep: async () => undefined,
    });
    setTimeout(() => controller.abort(), 5);
    const aborted = await pending.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(aborted).toBeDefined();
    expect(abortedCalls).toBe(1);
  });

  test("redacts response bodies with header secrets", async () => {
    const secret = "super-secret-token-42";
    const base = serve(
      () =>
        new Response(`upstream rejected ${secret}`, {
          status: 400,
          headers: { "content-type": "text/plain" },
        }),
    );
    const error = await failureOf(() =>
      postStream({
        url: base,
        headers: { authorization: `Bearer ${secret}` },
        body: {},
        signal: new AbortController().signal,
        retries: 0,
      }),
    );
    expect(error.message).not.toContain(secret);
    expect(error.message).toContain("[redacted]");
    expect(sanitizeBody(secret, { Authorization: `Bearer ${secret}` })).toBe("[redacted]");
  });

  test("types proxy connection failures and does not retry them", async () => {
    const fake = (() =>
      Promise.reject(new Error("connect ECONNREFUSED"))) as unknown as typeof fetch;
    const error = await withFetch(fake, () =>
      failureOf(() =>
        createProviderFetch({ proxy: "http://127.0.0.1:1", timeoutMs: 1_000 })(
          "https://example.com",
        ),
      ),
    ).then((value) => value as TransportError);
    expect(error.reason).toBe("proxy");
    expect(error.code).toBe("provider_failed");
    expect(error.retryable).toBe(false);
  });

  test("aborts an idle response body", async () => {
    const encoder = new TextEncoder();
    const base = serve(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode("data: first\n\n"));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const error = await failureOf(async () => {
      const transport = createProviderFetch({ idleTimeoutMs: 30 });
      const response = await transport(`${base}/stream`);
      await response.text();
    }).then((value) => value as TransportError);
    expect(error.reason).toBe("timeout");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("30");
  });
});

describe("provider config validation", () => {
  test("rejects invalid metadata, protocols and duplicate ids", () => {
    const base = { protocol: "openai-chat", baseUrl: "https://example.com/v1" };
    expect(ProviderConfigSchema.safeParse({ ...base, protocol: "unknown" }).success).toBe(false);
    expect(
      ProviderConfigSchema.safeParse({
        ...base,
        models: { m: { context: -1 } },
      }).success,
    ).toBe(false);
    expect(
      ProviderConfigSchema.safeParse({
        ...base,
        models: { m: { cost: { input: -1, output: 2 } } },
      }).success,
    ).toBe(false);
    const overflow = ProviderConfigSchema.safeParse({
      ...base,
      models: { m: { context: 1_000, output: 2_000 } },
    });
    expect(overflow.success).toBe(false);
    if (!overflow.success) expect(overflow.error.issues[0]?.message).toContain("exceeds");
    const duplicate = ProviderConfigSchema.safeParse({
      ...base,
      models: { "gpt-4": { name: "One" }, "GPT-4": { name: "Two" } },
    });
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) expect(duplicate.error.issues[0]?.message).toContain("duplicate");
    const duplicateApi = ProviderConfigSchema.safeParse({
      ...base,
      models: { one: { apiId: "same" }, two: { apiId: "same" } },
    });
    expect(duplicateApi.success).toBe(false);
  });

  test("ships failover and transport defaults without bumping the schema", () => {
    const config = defaultConfig();
    expect(config.failover).toEqual({
      enabled: false,
      providers: [],
      retryBudget: 2,
      cooldownMs: 30_000,
      failureThreshold: 3,
    });
    expect(config.transport).toEqual({
      timeoutMs: 120_000,
      idleTimeoutMs: 60_000,
      retries: 2,
    });
    const legacy = HarnessConfigSchema.parse({ provider: "openai" });
    expect(legacy.failover).toBeUndefined();
    expect(legacy.transport).toBeUndefined();
    expect(
      ProviderConfigSchema.parse({
        protocol: "openai-chat",
        baseUrl: "https://example.com/v1",
        transport: { idleTimeoutMs: 5_000, retries: 1 },
        failoverModels: ["backup"],
      }),
    ).toMatchObject({
      transport: { idleTimeoutMs: 5_000, retries: 1 },
      failoverModels: ["backup"],
    });
  });
});

describe("rate limit state", () => {
  test("records reset time and budget, then refuses calls while limited", async () => {
    let calls = 0;
    const base = serve(() => {
      calls += 1;
      return new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "2",
          "x-ratelimit-limit-requests": "100",
          "x-ratelimit-remaining-requests": "0",
        },
      });
    });
    const signal = new AbortController().signal;
    const first = await failureOf(() =>
      postStream({ url: base, headers: {}, body: {}, signal, retries: 0, providerId: "limited" }),
    ).then((value) => value as TransportError);
    expect(first.status).toBe(429);

    const state = rateLimitState("limited");
    expect(state?.limited).toBe(true);
    expect(state?.remaining).toBe(0);
    expect(state?.limit).toBe(100);
    expect(state?.resetAt).toBeGreaterThan(Date.now());
    expect(rateLimitDelayMs("limited")).toBeGreaterThan(1_000);

    const second = await failureOf(() =>
      postStream({ url: base, headers: {}, body: {}, signal, retries: 0, providerId: "limited" }),
    ).then((value) => value as TransportError);
    expect(second.retryable).toBe(false);
    expect(calls).toBe(1);
  });

  test("parses typed error bodies and duration headers", () => {
    expect(parseDurationMs("1m30s")).toBe(90_000);
    expect(parseDurationMs("250ms")).toBe(250);
    expect(parseDurationMs("2s")).toBe(2_000);
    expect(parseDurationMs("nope")).toBeUndefined();

    const now = 1_800_000_000_000;
    const state = parseRateLimit({
      status: 429,
      headers: { "x-ratelimit-reset-requests": "6m" },
      body: { error: { code: 429, status: "RESOURCE_EXHAUSTED" } },
      now,
    });
    expect(state?.limited).toBe(true);
    expect(state?.source).toBe("headers");
    expect(state?.resetAt).toBe(now + 360_000);

    const dated = parseRateLimit({
      status: 429,
      headers: { "retry-after": new Date(now + 5_000).toUTCString() },
      now,
    });
    expect(dated?.resetAt).toBeGreaterThanOrEqual(now + 4_000);
    expect(dated?.resetAt).toBeLessThanOrEqual(now + 5_000);
  });

  test("detects Gemini style retryDelay and exposes budget on success", async () => {
    const limited = serve(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              details: [{ retryDelay: "3s" }],
            },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
    );
    const now = Date.now();
    await failureOf(() =>
      postStream({
        url: limited,
        headers: {},
        body: {},
        signal: new AbortController().signal,
        retries: 0,
        providerId: "gemini-limit",
      }),
    );
    const limitedState = rateLimitState("gemini-limit");
    expect(limitedState?.limited).toBe(true);
    expect(limitedState?.resetAt).toBeGreaterThan(now + 2_000);
    expect(limitedState?.resetAt).toBeLessThan(now + 5_000);

    const healthy = serve(
      () =>
        new Response("ok", {
          headers: {
            "x-ratelimit-limit-requests": "100",
            "x-ratelimit-remaining-requests": "42",
            "x-ratelimit-reset-requests": "1s",
          },
        }),
    );
    const response = await postStream({
      url: healthy,
      headers: {},
      body: {},
      signal: new AbortController().signal,
      providerId: "healthy",
    });
    expect(await response.text()).toBe("ok");
    const state = rateLimitState("healthy");
    expect(state?.limited).toBe(false);
    expect(state?.remaining).toBe(42);
    expect(state?.limit).toBe(100);
  });
});
