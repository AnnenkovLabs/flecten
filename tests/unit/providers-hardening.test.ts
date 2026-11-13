import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { FailoverConfigSchema } from "../../src/config/schema";
import {
  catalogLastError,
  loadAgentOne,
  loadModelsDev,
  resetCatalogCache,
} from "../../src/providers/catalog";
import { discoverProvider } from "../../src/providers/discovery";
import {
  buildFailoverPlan,
  CircuitBreaker,
  classifyStatusKind,
  type FailoverTarget,
  ProviderFailure,
  streamWithFailover,
} from "../../src/providers/failover";
import { TransportError } from "../../src/providers/transport";
import type { ModelEvent } from "../../src/providers/types";
import {
  cleanupProviders,
  collect,
  serve,
  tempDir,
  writeCache,
} from "../helpers/provider-hardening";

afterEach(cleanupProviders);

describe("provider failure classification", () => {
  test("classifies rate limit, quota, auth and context", () => {
    const rate = ProviderFailure.from(
      new TransportError("slow down", { reason: "http", status: 429, retryable: true }),
    );
    expect(rate.kind).toBe("rate_limit");
    expect(rate.retryable).toBe(true);

    const quota = ProviderFailure.from(
      new TransportError("no budget", {
        reason: "http",
        status: 429,
        retryable: true,
        bodyText: JSON.stringify({ error: { code: "insufficient_quota" } }),
      }),
    );
    expect(quota.kind).toBe("quota");
    expect(quota.retryable).toBe(false);

    const auth = ProviderFailure.from(
      new TransportError("bad key", { reason: "http", status: 401 }),
    );
    expect(auth.kind).toBe("auth");
    expect(auth.retryable).toBe(false);

    const context = ProviderFailure.from(
      new TransportError("too long", {
        reason: "http",
        status: 400,
        bodyText: JSON.stringify({ error: { code: "context_length_exceeded" } }),
      }),
    );
    expect(context.kind).toBe("context");
    expect(context.code).toBe("context_overflow");
    expect(context.retryable).toBe(false);

    const aborted = ProviderFailure.from(new DOMException("Aborted", "AbortError"));
    expect(aborted.kind).toBe("aborted");
    expect(aborted.retryable).toBe(false);
  });

  test("parses structured error codes and status classes", () => {
    expect(classifyStatusKind(500)).toBe("server");
    expect(classifyStatusKind(413)).toBe("context");
    expect(classifyStatusKind(402)).toBe("quota");
    expect(classifyStatusKind(undefined)).toBe("unknown");
  });
});

describe("failover planning", () => {
  const primary: FailoverTarget = { provider: "a", model: "m1" };
  const config = FailoverConfigSchema.parse({
    providers: [
      { provider: "b", model: "x" },
      { provider: "a", model: "m2" },
    ],
  });

  test("orders models then providers and removes duplicates", () => {
    const plan = buildFailoverPlan(primary, config, {
      a: { failoverModels: ["m2", "m3"] },
    });
    expect(plan).toEqual([
      { provider: "a", model: "m1" },
      { provider: "a", model: "m2" },
      { provider: "a", model: "m3" },
      { provider: "b", model: "x" },
    ]);
  });

  test("keeps only the primary target when disabled", () => {
    expect(buildFailoverPlan(primary, FailoverConfigSchema.parse({ enabled: false }))).toEqual([
      primary,
    ]);
  });
});

describe("failover runner", () => {
  const plan: FailoverTarget[] = [
    { provider: "a", model: "m1" },
    { provider: "b", model: "m2" },
  ];

  test("spends the retry budget before falling back", async () => {
    const attempts: string[] = [];
    async function* run(target: FailoverTarget): AsyncGenerator<ModelEvent> {
      attempts.push(`${target.provider}:${target.model}`);
      if (target.provider === "a") {
        throw new TransportError("overloaded", {
          reason: "http",
          status: 503,
          retryable: true,
        });
      }
      yield { type: "text", delta: "ok" };
      yield { type: "done", reason: "end" };
    }
    const events = await collect(
      streamWithFailover({
        plan,
        run,
        config: FailoverConfigSchema.parse({ retryBudget: 1, failureThreshold: 10 }),
        sleep: async () => undefined,
        random: () => 0,
      }),
    );
    expect(attempts).toEqual(["a:m1", "a:m1", "b:m2"]);
    expect(events.at(-1)).toEqual({ type: "done", reason: "end" });
  });

  test("does not retry auth failures", async () => {
    const attempts: string[] = [];
    async function* run(target: FailoverTarget): AsyncGenerator<ModelEvent> {
      attempts.push(target.provider);
      if (target.provider === "a") {
        throw new TransportError("bad key", { reason: "http", status: 401 });
      }
      yield { type: "done", reason: "end" };
    }
    await collect(
      streamWithFailover({
        plan,
        run,
        config: FailoverConfigSchema.parse({ retryBudget: 5 }),
        sleep: async () => undefined,
      }),
    );
    expect(attempts).toEqual(["a", "b"]);
  });

  test("skips targets with an open circuit", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1_000,
      now: () => now,
    });
    breaker.recordFailure(plan[0] as FailoverTarget);
    expect(breaker.canAttempt(plan[0] as FailoverTarget)).toBe(false);
    const skipped: string[] = [];
    async function* run(): AsyncGenerator<ModelEvent> {
      yield { type: "done", reason: "end" };
    }
    await collect(
      streamWithFailover({
        plan,
        run,
        breaker,
        onAttempt: (attempt) => {
          if (attempt.skipped) skipped.push(attempt.target.provider);
        },
      }),
    );
    expect(skipped).toEqual(["a"]);
    now = 1_001;
    expect(breaker.state(plan[0] as FailoverTarget)).toBe("half-open");
    breaker.recordSuccess(plan[0] as FailoverTarget);
    expect(breaker.state(plan[0] as FailoverTarget)).toBe("closed");
  });
});

describe("catalog sources", () => {
  test("keeps last-known-good cache when a response is empty", async () => {
    let empty = false;
    let calls = 0;
    const base = serve(() => {
      calls += 1;
      if (empty) return Response.json({});
      return Response.json({
        local: {
          id: "local",
          name: "Local",
          api: "http://127.0.0.1:1/v1",
          npm: "@ai-sdk/openai-compatible",
          models: { "model-a": { id: "model-a", name: "Model A", limit: { context: 32_000 } } },
        },
      });
    });
    const cwd = await tempDir();
    const first = await loadModelsDev(cwd, false, { url: `${base}/models` });
    expect(Object.keys(first)).toEqual(["local"]);
    empty = true;
    const forced = await loadModelsDev(cwd, true, { url: `${base}/models` });
    expect(Object.keys(forced)).toEqual(["local"]);
    expect(catalogLastError("models.dev")).toContain("no models");
    const cache = (await Bun.file(join(cwd, ".liquid", "cache", "models-dev.json")).json()) as {
      local?: unknown;
    };
    expect(cache.local).toBeDefined();
    expect(calls).toBe(2);
  });

  test("keeps last-known-good when a later response is invalid", async () => {
    let invalid = false;
    const base = serve(() => {
      if (invalid) return Response.json({ local: 1 });
      return Response.json({
        local: {
          id: "local",
          name: "Local",
          api: "http://127.0.0.1:1/v1",
          npm: "@ai-sdk/openai-compatible",
          models: { "model-a": { id: "model-a", name: "Model A" } },
        },
      });
    });
    const cwd = await tempDir();
    const first = await loadModelsDev(cwd, false, { url: `${base}/models` });
    expect(first.local?.models["model-a"]).toBeDefined();
    invalid = true;
    const forced = await loadModelsDev(cwd, true, { url: `${base}/models` });
    expect(forced.local?.models["model-a"]).toBeDefined();
    expect(catalogLastError("models.dev")).toContain("schema mismatch");
    const cache = (await Bun.file(join(cwd, ".liquid", "cache", "models-dev.json")).json()) as {
      local?: { models?: Record<string, unknown> };
    };
    expect(cache.local?.models?.["model-a"]).toBeDefined();
  });

  test("respects the cache TTL without a network call", async () => {
    let calls = 0;
    const base = serve(() => {
      calls += 1;
      return Response.json({
        local: {
          id: "local",
          name: "Local",
          api: "http://127.0.0.1:1/v1",
          npm: "@ai-sdk/openai-compatible",
          models: { "model-a": { id: "model-a", name: "Model A" } },
        },
      });
    });
    const cwd = await tempDir();
    await loadModelsDev(cwd, false, { url: `${base}/models` });
    resetCatalogCache();
    const cached = await loadModelsDev(cwd, false, { url: `${base}/models` });
    expect(Object.keys(cached)).toEqual(["local"]);
    expect(calls).toBe(1);
  });

  test("reports a clear schema error and rejects duplicate model ids", async () => {
    const base = serve((request) => {
      if (new URL(request.url).pathname === "/bad") return Response.json({ local: 1 });
      return Response.json({
        local: {
          id: "local",
          api: "http://127.0.0.1:1/v1",
          npm: "@ai-sdk/openai-compatible",
          models: {
            one: { id: "same", name: "One" },
            two: { id: "same", name: "Two" },
          },
        },
      });
    });
    const badCwd = await tempDir();
    resetCatalogCache();
    expect(await loadModelsDev(badCwd, true, { url: `${base}/bad` })).toEqual({});
    expect(catalogLastError("models.dev")).toContain("schema mismatch");

    const duplicateCwd = await tempDir();
    resetCatalogCache();
    expect(await loadModelsDev(duplicateCwd, true, { url: `${base}/duplicates` })).toEqual({});
    expect(catalogLastError("models.dev")).toContain("duplicate model id");
  });

  test("keeps agent-one last-known-good instead of an empty response", async () => {
    let empty = false;
    const base = serve(() => {
      if (empty) return new Response("", { headers: { "content-type": "text/html" } });
      return new Response(
        '{"id":"model-a","name":"Model A","features":{"tool_call":true},"limit":{"context":32000,"output":8000}}',
        { headers: { "content-type": "text/html" } },
      );
    });
    const cwd = await tempDir();
    const first = await loadAgentOne(cwd, false, { url: `${base}/list` });
    expect(first["model-a"]?.context).toBe(32_000);
    empty = true;
    const forced = await loadAgentOne(cwd, true, { url: `${base}/list` });
    expect(forced["model-a"]?.output).toBe(8_000);
    const cache = (await Bun.file(join(cwd, ".liquid", "cache", "agent-one.json")).json()) as {
      "model-a"?: unknown;
    };
    expect(cache["model-a"]).toBeDefined();
  });
});

describe("discovery validation", () => {
  test("drops metadata with output larger than the context window", async () => {
    const base = serve(() =>
      Response.json({
        data: [{ id: "broken", context_length: 1_000, max_output_tokens: 5_000 }],
      }),
    );
    const cwd = await tempDir();
    await writeCache(cwd, "models-dev.json", {});
    await writeCache(cwd, "agent-one.json", {});
    resetCatalogCache();
    const result = await discoverProvider(cwd, {
      protocol: "openai-chat",
      baseUrl: `${base}/v1`,
    });
    expect(result.models.broken).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("dropped invalid metadata");
  });

  test("rejects duplicate model ids from the provider", async () => {
    const base = serve(() => Response.json({ data: [{ id: "same" }, { id: "SAME" }] }));
    const cwd = await tempDir();
    await writeCache(cwd, "models-dev.json", {});
    await writeCache(cwd, "agent-one.json", {});
    resetCatalogCache();
    await expect(
      discoverProvider(cwd, { protocol: "openai-chat", baseUrl: `${base}/v1` }),
    ).rejects.toThrow("duplicate model id");
  });

  test("rejects an unexpected response schema", async () => {
    const base = serve(() => Response.json({ data: "nope" }));
    const cwd = await tempDir();
    await writeCache(cwd, "models-dev.json", {});
    await writeCache(cwd, "agent-one.json", {});
    resetCatalogCache();
    await expect(
      discoverProvider(cwd, { protocol: "openai-chat", baseUrl: `${base}/v1` }),
    ).rejects.toThrow("unexpected response schema");
  });

  test("refuses an empty model list so saved models stay", async () => {
    const base = serve(() => Response.json({ data: [] }));
    const cwd = await tempDir();
    await writeCache(cwd, "models-dev.json", {});
    await writeCache(cwd, "agent-one.json", {});
    resetCatalogCache();
    await expect(
      discoverProvider(cwd, { protocol: "openai-chat", baseUrl: `${base}/v1` }),
    ).rejects.toThrow("returned an empty list");
  });
});
