import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import { postStream } from "../../src/providers/http";
import { parseRateLimit, providerErrorCode, resetRateLimits } from "../../src/providers/rate-limit";
import { TransportError } from "../../src/providers/transport";
import type { ModelEvent, ModelProvider } from "../../src/providers/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";

const NOW = 1_800_000_000_000;
const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

afterEach(() => resetRateLimits());

describe("subscription windows", () => {
  test("reads the Claude unified 5-hour window and its reset", () => {
    const state = parseRateLimit({
      status: 429,
      headers: {
        "anthropic-ratelimit-unified-status": "rejected",
        "anthropic-ratelimit-unified-representative-claim": "five_hour",
        "anthropic-ratelimit-unified-reset": String((NOW + 2 * 3_600_000) / 1_000),
      },
      now: NOW,
    });
    expect(state).toMatchObject({ limited: true, kind: "five_hour", resetAt: NOW + 7_200_000 });
  });

  test("reads a weekly Claude window", () => {
    const state = parseRateLimit({
      status: 429,
      headers: {
        "anthropic-ratelimit-unified-status": "rejected",
        "anthropic-ratelimit-unified-representative-claim": "seven_day",
        "anthropic-ratelimit-unified-reset": String(NOW / 1_000 + 86_400 * 3),
      },
      now: NOW,
    });
    expect(state?.kind).toBe("weekly");
  });

  test("reads Codex primary and secondary windows", () => {
    const fiveHour = parseRateLimit({
      status: 429,
      headers: {
        "x-codex-primary-used-percent": "100",
        "x-codex-primary-window-minutes": "300",
        "x-codex-primary-reset-after-seconds": "1200",
        "x-codex-secondary-used-percent": "40",
        "x-codex-secondary-window-minutes": "10080",
      },
      now: NOW,
    });
    expect(fiveHour).toMatchObject({ limited: true, kind: "five_hour", resetAt: NOW + 1_200_000 });

    const weekly = parseRateLimit({
      status: 429,
      headers: {
        "x-codex-primary-used-percent": "20",
        "x-codex-primary-window-minutes": "300",
        "x-codex-secondary-used-percent": "100",
        "x-codex-secondary-window-minutes": "10080",
        "x-codex-secondary-reset-at": String(NOW / 1_000 + 3_600),
      },
      now: NOW,
    });
    expect(weekly).toMatchObject({ limited: true, kind: "weekly", resetAt: NOW + 3_600_000 });
  });

  test("reads usage_limit_reached bodies and billing codes", () => {
    const usage = parseRateLimit({
      status: 429,
      body: { error: { type: "usage_limit_reached", resets_in_seconds: 900 } },
      now: NOW,
    });
    expect(usage).toMatchObject({ limited: true, kind: "five_hour", resetAt: NOW + 900_000 });

    const billing = parseRateLimit({
      status: 429,
      body: JSON.stringify({ error: { code: "insufficient_quota", type: "insufficient_quota" } }),
      now: NOW,
    });
    expect(billing?.kind).toBe("billing");
    expect(providerErrorCode({ error: { code: "context_length_exceeded" } })).toBe(
      "context_length_exceeded",
    );
  });
});

describe("provider http on long limits", () => {
  test("does not hammer a five-hour window and reports its reset", async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;
        return new Response(
          JSON.stringify({ error: { type: "usage_limit_reached", resets_in_seconds: 3_600 } }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      },
    });
    try {
      const error = await postStream({
        url: `http://localhost:${server.port}`,
        headers: {},
        body: {},
        signal: new AbortController().signal,
        retries: 2,
        providerId: "codex-window",
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(TransportError);
      const transport = error as TransportError;
      expect(calls).toBe(1);
      expect(transport.limitKind).toBe("five_hour");
      expect(transport.resetAt).toBeGreaterThan(Date.now() + 3_500_000);
    } finally {
      server.stop(true);
    }
  });
});

function session(provider: ModelProvider, cwd: string) {
  return createSession({
    cwd,
    provider,
    providerId: provider.id,
    model: provider.model,
    tools: new ToolRegistry(builtinTools(), { limits }),
    system: "test",
    limits,
    maxOutputTokens: 1000,
    context: { window: 100_000, reserve: 1000 },
    loop: { maxTurns: 4, continuations: 0, parallelTools: false },
    logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
  });
}

describe("goal loop on limits", () => {
  test("waits for the reset with a typed event, then continues the same turn", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      id: "limit-test",
      model: "limit-model",
      async *stream(): AsyncIterable<ModelEvent> {
        calls += 1;
        if (calls === 1) {
          throw new TransportError("provider returned 429", {
            reason: "http",
            status: 429,
            limitKind: "five_hour",
            resetAt: Date.now() + 40,
            retryAfterMs: 40,
          });
        }
        yield { type: "text", delta: "after the reset" };
        yield { type: "done", reason: "end" };
      },
    };
    const cwd = await mkdtemp(join(tmpdir(), "liquid-limit-"));
    try {
      const events: Event[] = [];
      const handle = session(provider, cwd);
      handle.subscribe((event) => events.push(event));
      const result = (await handle.send({ type: "run", prompt: "hello" })) as RunResult;
      expect(result.stopReason).toBe("end");
      expect(calls).toBe(2);
      const retry = events.find((event) => event.type === "provider.retry");
      expect(retry).toMatchObject({ type: "provider.retry", kind: "quota_5h", attempt: 1 });
      expect(events.some((event) => event.type === "message.reset")).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("a weekly limit ends the run with its kind and reset time", async () => {
    const resetAt = Date.now() + 3 * 86_400_000;
    const provider: ModelProvider = {
      id: "weekly-test",
      model: "weekly-model",
      // biome-ignore lint/correctness/useYield: the provider fails before streaming
      async *stream(): AsyncIterable<ModelEvent> {
        throw new TransportError("provider returned 429", {
          reason: "http",
          status: 429,
          limitKind: "weekly",
          resetAt,
          retryAfterMs: resetAt - Date.now(),
        });
      },
    };
    const cwd = await mkdtemp(join(tmpdir(), "liquid-weekly-"));
    try {
      const events: Event[] = [];
      const handle = session(provider, cwd);
      handle.subscribe((event) => events.push(event));
      const result = (await handle.send({ type: "run", prompt: "hello" })) as RunResult;
      expect(result.stopReason).toBe("error");
      const error = events.find((event) => event.type === "error");
      expect(error).toMatchObject({ code: "provider_limit", limit: "weekly" });
      expect(error?.type === "error" ? error.resetAt : 0).toBeGreaterThan(Date.now());
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
