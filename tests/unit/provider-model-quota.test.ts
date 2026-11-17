import { afterEach, expect, test } from "bun:test";
import { HarnessConfigSchema } from "../../src/config/schema";
import { ProviderFailure } from "../../src/providers/failover";
import { parseRateLimit, resetRateLimits } from "../../src/providers/rate-limit";
import { createProvider, invalidateProviderAuthorization } from "../../src/providers/registry";
import { TransportError } from "../../src/providers/transport";
import { collect, request } from "../helpers/provider-adapters";

afterEach(resetRateLimits);

test("model_quota_exhausted is a model quota even when the outer type says rate_limit_error", () => {
  const body = {
    error: { code: "model_quota_exhausted", type: "rate_limit_error", message: "private prose" },
  };
  expect(parseRateLimit({ status: 429, body })).toMatchObject({
    limited: true,
    kind: "model_quota",
    providerCode: "model_quota_exhausted",
  });
  expect(
    ProviderFailure.from(
      new TransportError("quota", { reason: "http", status: 429, bodyText: JSON.stringify(body) }),
    ).kind,
  ).toBe("quota");
});

test("separate provider handles share exhausted-route state and keep another model usable", async () => {
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { model: string };
      calls.push(body.model);
      if (body.model === "frontier")
        return Response.json(
          { error: { code: "model_quota_exhausted", type: "rate_limit_error" } },
          { status: 429 },
        );
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
  try {
    const config = HarnessConfigSchema.parse({
      useDefaults: false,
      provider: "shared-quota",
      model: "frontier",
      providers: {
        "shared-quota": {
          protocol: "openai-chat",
          baseUrl: server.url.toString(),
          models: { frontier: {}, available: {} },
          transport: { retries: 2 },
        },
      },
    });
    const run = (model: string) =>
      collect(
        createProvider(config).provider.stream(
          { ...request(), model },
          new AbortController().signal,
        ),
      );
    const first = await run("frontier").catch((error: unknown) => error);
    const second = await run("frontier").catch((error: unknown) => error);
    expect(first).toMatchObject({
      limitKind: "model_quota",
      providerCode: "model_quota_exhausted",
    });
    expect(second).toMatchObject({
      limitKind: "model_quota",
      providerCode: "model_quota_exhausted",
      retryable: false,
    });
    expect(second).toHaveProperty("retryAfterMs", undefined);
    expect(calls).toEqual(["frontier"]);
    expect((await run("available")).at(-1)).toMatchObject({ type: "done", reason: "end" });
    invalidateProviderAuthorization("shared-quota");
    await run("frontier").catch(() => undefined);
    expect(calls).toEqual(["frontier", "available", "frontier"]);
  } finally {
    server.stop(true);
  }
});

test("configured quota groups stop aliases without blocking independent groups", async () => {
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { model } = (await req.json()) as { model: string };
      calls.push(model);
      if (model === "frontier")
        return Response.json({ error: { code: "model_quota_exhausted" } }, { status: 429 });
      return new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    },
  });
  try {
    const config = HarnessConfigSchema.parse({
      useDefaults: false,
      provider: "quota-groups",
      model: "frontier",
      providers: {
        "quota-groups": {
          protocol: "openai-chat",
          baseUrl: server.url.toString(),
          transport: { retries: 0 },
          models: {
            frontier: { quotaGroup: "premium" },
            alias: { quotaGroup: "premium" },
            available: { quotaGroup: "standard" },
          },
        },
      },
    });
    const run = (model: string) =>
      collect(
        createProvider(config).provider.stream(
          { ...request(), model },
          new AbortController().signal,
        ),
      );
    await run("frontier").catch(() => undefined);
    const denied = await run("alias").catch((error: unknown) => error);
    expect(denied).toMatchObject({ limitKind: "model_quota", retryable: false });
    expect(calls).toEqual(["frontier"]);
    expect((await run("available")).at(-1)).toMatchObject({ type: "done" });
    expect(calls).toEqual(["frontier", "available"]);
  } finally {
    server.stop(true);
  }
});
