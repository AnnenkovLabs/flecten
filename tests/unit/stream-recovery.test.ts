import { describe, expect, test } from "bun:test";
import {
  assessStream,
  decideRecovery,
  RetryPolicy,
  type RetryPolicyOptions,
  type StreamEvent,
  StreamTracker,
} from "../../src/providers/stream-recovery";

function track(...events: StreamEvent[]): StreamTracker {
  const tracker = new StreamTracker();
  for (const event of events) tracker.feed(event);
  return tracker;
}

function makePolicy(options: RetryPolicyOptions = {}): RetryPolicy {
  return new RetryPolicy({
    baseDelayMs: 100,
    maxDelayMs: 10_000,
    jitter: 0,
    random: () => 0.5,
    ...options,
  });
}

describe("stream tracking", () => {
  test("normal completion keeps partial output and reports complete", () => {
    const tracker = track(
      { type: "text", delta: "hel" },
      { type: "reasoning", delta: "think" },
      { type: "tool_call", id: "call_1", name: "read", args: { path: "a" } },
      { type: "usage", input: 10, output: 5, cached: 0 },
      { type: "done", reason: "tool_use" },
    );

    expect(tracker.terminal).toBe(true);
    expect(tracker.finishReason).toBe("tool_use");
    expect(tracker.lastSeq).toBe(5);
    expect(tracker.bytes).toBe(8);
    expect(tracker.toolCallCount).toBe(1);
    expect(tracker.sawDone).toBe(true);
    expect(tracker.sawUsage).toBe(true);
    expect(assessStream(tracker)).toEqual({
      status: "complete",
      retry: "none",
      reason: "terminal done event",
      safeToContinue: true,
    });
  });

  test("missing done is incomplete and recommends resume when output exists", () => {
    const tracker = track({ type: "text", delta: "partial" });
    const assessment = assessStream(tracker);

    expect(tracker.terminal).toBe(false);
    expect(assessment).toEqual({
      status: "incomplete",
      retry: "resume",
      reason: "stream ended without a terminal event",
      safeToContinue: false,
    });
    expect(decideRecovery(assessment, 0, makePolicy()).action).toBe("restart");
  });

  test("max_tokens stop is truncated and safe to continue", () => {
    const tracker = track(
      { type: "reasoning", delta: "cut" },
      { type: "done", reason: "max_tokens" },
    );
    const assessment = assessStream(tracker);
    const decision = decideRecovery(assessment, 0, makePolicy());

    expect(assessment).toEqual({
      status: "truncated",
      retry: "none",
      reason: "output token limit reached",
      safeToContinue: true,
    });
    expect(decision).toEqual({
      action: "fail",
      delayMs: 0,
      dropPartial: false,
      reason: "nothing to recover: output limit reached; use normal continuation",
    });
  });

  test("content filter and safety are refused without retry", () => {
    const filteredDone = assessStream(
      track({ type: "text", delta: "x" }, { type: "done", reason: "content_filter" }),
    );
    expect(filteredDone).toEqual({
      status: "refused",
      retry: "none",
      reason: "finish reason: content_filter",
      safeToContinue: false,
    });

    const safetyError = assessStream(track({ type: "error", kind: "safety", message: "blocked" }));
    expect(safetyError.status).toBe("refused");
    expect(safetyError.retry).toBe("none");

    const decision = decideRecovery(filteredDone, 0, makePolicy({ supportsResume: true }));
    expect(decision.action).toBe("fail");
    expect(decision.dropPartial).toBe(true);
  });

  test("provider filter maps to filtered without retry", () => {
    const assessment = assessStream(
      track({ type: "error", kind: "filtered", message: "response removed" }),
    );
    expect(assessment.status).toBe("filtered");
    expect(assessment.retry).toBe("none");
    expect(decideRecovery(assessment, 0, makePolicy()).action).toBe("fail");
  });

  test("network drop yields incomplete with a typed error kind", () => {
    const tracker = track(
      { type: "text", delta: "half a thought" },
      { type: "error", kind: "network", message: "socket closed" },
    );
    const assessment = assessStream(tracker);

    expect(tracker.terminal).toBe(true);
    expect(assessment).toMatchObject({
      status: "incomplete",
      retry: "resume",
      reason: "stream error: network",
      safeToContinue: false,
      errorKind: "network",
    });
  });
});

describe("recovery decisions", () => {
  const disconnect = track(
    { type: "reasoning", delta: "partial thought" },
    { type: "error", kind: "network", message: "socket closed" },
  );
  const assessment = assessStream(disconnect);

  test("resume unsupported restarts and drops the partial answer", () => {
    const decision = decideRecovery(assessment, 0, makePolicy({ supportsResume: false }));
    expect(decision).toEqual({
      action: "restart",
      delayMs: 100,
      dropPartial: true,
      reason: "restart after stream error: network",
    });
  });

  test("resume supported keeps the partial answer", () => {
    const decision = decideRecovery(assessment, 1, makePolicy({ supportsResume: true }));
    expect(decision).toEqual({
      action: "resume",
      delayMs: 200,
      dropPartial: false,
      reason: "resume after stream error: network",
    });
  });

  test("circuit breaker stops retries until cooldown", () => {
    let clock = 0;
    const policy = makePolicy({
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 1_000,
      now: () => clock,
    });

    expect(decideRecovery(assessment, 0, policy).action).toBe("restart");
    expect(decideRecovery(assessment, 1, policy).action).toBe("fail");
    expect(policy.isOpen()).toBe(true);

    clock = 1_000;
    expect(policy.isOpen()).toBe(false);
    expect(decideRecovery(assessment, 2, policy).action).toBe("restart");

    policy.recordSuccess();
    expect(policy.isOpen()).toBe(false);
  });
});

describe("retry policy", () => {
  test("applies exponential backoff, jitter, and rate-limit reset", () => {
    const backoff = makePolicy({ baseDelayMs: 100, maxDelayMs: 1_000, jitter: 0 });
    expect([0, 1, 2, 3, 9].map((attempt) => backoff.delay(attempt))).toEqual([
      100, 200, 400, 800, 1_000,
    ]);

    const positive = makePolicy({
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      jitter: 0.5,
      random: () => 1,
    });
    expect(positive.delay(0)).toBe(1_500);

    const negative = makePolicy({
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      jitter: 0.5,
      random: () => 0,
    });
    expect(negative.delay(0)).toBe(500);

    const reset = assessStream(
      track({ type: "error", kind: "rate_limit", message: "slow down", retryAfterMs: 7_000 }),
    );
    expect(decideRecovery(reset, 0, makePolicy({ rateLimitResetMs: 5_000 })).delayMs).toBe(7_000);

    const fallback = assessStream(
      track({ type: "error", kind: "rate_limit", message: "slow down" }),
    );
    expect(decideRecovery(fallback, 0, makePolicy({ rateLimitResetMs: 5_000 })).delayMs).toBe(
      5_000,
    );
  });
});

describe("typed state only", () => {
  test("classification ignores error message text", () => {
    const assessment = assessStream(
      track({
        type: "error",
        kind: "network",
        message: "content_filter safety max_tokens refusal",
      }),
    );
    expect(assessment.status).toBe("incomplete");
    expect(assessment.retry).toBe("restart");
  });

  test("source contains no regular expressions", async () => {
    const source = await Bun.file(
      new URL("../../src/providers/stream-recovery.ts", import.meta.url),
    ).text();
    expect(source).not.toContain("RegExp");
    expect(source).not.toContain(".match(");
    expect(source).not.toContain(".test(");
    expect(source).not.toContain(".replace(");
    expect(source).not.toContain(".exec(");
  });
});
