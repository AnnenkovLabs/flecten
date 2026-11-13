import { beforeEach, describe, expect, test } from "bun:test";
import { parseCompletionSignal } from "../../src/core/goal/completion";
import { classifyFailure, RetryPolicy } from "../../src/core/goal/retry";
import { GoalState, shouldContinue } from "../../src/core/goal/state";
import type { GoalInit, RetryFailure, RetryPolicyOptions } from "../../src/core/goal/types";

let clock = 0;

beforeEach(() => {
  clock = 0;
});

function makePolicy(options: RetryPolicyOptions = {}): RetryPolicy {
  return new RetryPolicy({
    baseDelayMs: 100,
    maxDelayMs: 1_000,
    jitter: 0,
    random: () => 0.5,
    now: () => clock,
    ...options,
  });
}

function makeGoal(overrides: Partial<GoalInit> = {}): GoalState {
  return new GoalState({
    id: "g1",
    objective: "ship goal mode",
    criteria: ["phase 1", "phase 2"],
    budget: { maxAttempts: 5 },
    now: () => clock,
    ...overrides,
  });
}

describe("goal state", () => {
  test("tracks lifecycle, attempts, criteria and evidence", () => {
    clock = 100;
    const goal = makeGoal();

    expect(goal.status).toBe("active");
    expect(goal.attempts).toBe(0);
    expect(goal.startedAt).toBe(100);

    goal.start();
    expect(goal.attempts).toBe(1);

    clock = 200;
    const entry = goal.addEvidence({ detail: "tests pass", criterion: 0 });
    expect(entry).toBe("tests pass");
    expect(goal.remainingCriteria()).toEqual(["phase 2"]);

    goal.pause();
    expect(goal.status).toBe("paused");
    goal.resume();
    expect(goal.status).toBe("active");

    goal.markBlocked("missing credentials");
    expect(goal.status).toBe("blocked");
    expect(goal.blockedReason).toBe("missing credentials");

    goal.markMet("shipped");
    expect(goal.status).toBe("met");
    expect(goal.remainingCriteria()).toEqual([]);
    expect(goal.evidence).toEqual(["tests pass", "shipped"]);
  });

  test("rejects evidence for an unknown criterion", () => {
    const goal = makeGoal();
    expect(() => goal.addEvidence({ detail: "x", criterion: 9 })).toThrow("out of range");
  });

  test("does not stop on a phase question while criteria remain", () => {
    const goal = makeGoal();
    goal.start();

    expect(shouldContinue(goal, { text: "Phase 1 is done. Should I start phase 2?" })).toEqual({
      action: "continue",
      reason: "2 acceptance criteria remain",
    });
  });

  test("finishes when every criterion has evidence", () => {
    const goal = makeGoal();
    goal.addEvidence({ detail: "phase 1 done", criterion: 0 });
    goal.addEvidence({ detail: "phase 2 done", criterion: 1 });

    expect(shouldContinue(goal, { text: "Should I continue?" })).toEqual({
      action: "finish",
      reason: "all acceptance criteria have evidence",
    });
  });

  test("a completion signal closes the turn", () => {
    const goal = makeGoal();
    goal.start();

    const signal = parseCompletionSignal("Work is done.\n<complete>Shipped.</complete>");
    expect(shouldContinue(goal, signal)).toEqual({
      action: "finish",
      reason: "completion signal received",
    });
  });

  test("a met goal stays finished", () => {
    const goal = makeGoal();
    goal.markMet();
    expect(shouldContinue(goal)).toEqual({ action: "finish", reason: "goal is already met" });
  });

  test("paused goals ask and blocked goals stay blocked", () => {
    const paused = makeGoal();
    paused.pause();
    expect(shouldContinue(paused).action).toBe("ask");

    const blocked = makeGoal();
    blocked.markBlocked("needs an API key");
    expect(shouldContinue(blocked)).toEqual({
      action: "blocked",
      reason: "needs an API key",
    });
  });

  test("explicit user decisions are the only text-free reason to ask", () => {
    const goal = makeGoal();
    goal.start();
    expect(
      shouldContinue(goal, { requiresUser: true, reason: "choose a storage backend" }),
    ).toEqual({ action: "ask", reason: "choose a storage backend" });
  });

  test("budget exhaustion blocks instead of looping", () => {
    const goal = makeGoal({ budget: { maxAttempts: 1 } });
    goal.start();
    expect(shouldContinue(goal)).toEqual({
      action: "blocked",
      reason: "goal budget is exhausted",
    });
  });
});

describe("retry policy", () => {
  test("retries 429 with the Retry-After header", () => {
    const failure = classifyFailure({ status: 429, headers: { "retry-after": "2" } });
    expect(failure.kind).toBe("rate_limit");
    expect(failure.retryAfterMs).toBe(2_000);

    expect(makePolicy().decide(failure, 0)).toEqual({
      retry: true,
      delayMs: 2_000,
      reason: "rate limit reset window",
      kind: "rate_limit",
    });
  });

  test("holds a 5-hour quota until its reset time", () => {
    clock = 1_000;
    const failure = classifyFailure({
      kind: "quota_5h",
      status: 429,
      resetAt: clock + 18_000_000,
    });
    expect(failure.kind).toBe("quota_5h");

    const policy = makePolicy();
    expect(policy.decide(failure, 0)).toEqual({
      retry: true,
      delayMs: 18_000_000,
      reason: "subscription limit reset window",
      kind: "quota_5h",
    });

    clock = 6_000;
    expect(policy.decide(failure, 1)).toEqual({
      retry: true,
      delayMs: 18_000_000 - 5_000,
      reason: "subscription limit reset window",
      kind: "quota_5h",
    });
  });

  test("limit waits do not burn the network retry budget", () => {
    const policy = makePolicy({ maxAttempts: 2, maxLimitWaits: 5 });
    const limit: RetryFailure = { kind: "rate_limit", retryAfterMs: 1_000 };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(policy.decide(limit, attempt).retry).toBe(true);
    }
    expect(policy.decide(limit, 5)).toMatchObject({
      retry: false,
      reason: "limit persisted after 5 waits",
    });
  });

  test("a reset later than the wait cap ends the run with the delay", () => {
    const policy = makePolicy({ maxLimitWaitMs: 60_000 });
    const decision = policy.decide({ kind: "quota_weekly", retryAfterMs: 3 * 86_400_000 }, 0);
    expect(decision).toEqual({
      retry: false,
      delayMs: 3 * 86_400_000,
      reason: "limit resets later than the wait cap",
      kind: "quota_weekly",
    });
  });

  test("classifies transport limit kinds, billing, silent streams and context codes", () => {
    expect(classifyFailure({ status: 429, limitKind: "five_hour", resetAt: 5_000 }).kind).toBe(
      "quota_5h",
    );
    expect(classifyFailure({ status: 429, limitKind: "weekly" }).kind).toBe("quota_weekly");
    expect(classifyFailure({ status: 429, limitKind: "billing" }).kind).toBe("billing");
    expect(classifyFailure({ status: 402 }).kind).toBe("billing");
    expect(classifyFailure({ reason: "timeout" }).kind).toBe("network");
    expect(classifyFailure({ status: 400, providerCode: "context_length_exceeded" }).kind).toBe(
      "context",
    );
    expect(makePolicy().decide({ kind: "billing" }, 0)).toEqual({
      retry: false,
      delayMs: 0,
      reason: "billing failures are not retryable",
      kind: "billing",
    });
  });

  test("retries a network drop with capped exponential backoff", () => {
    const drop = Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
    const failure = classifyFailure(drop);
    expect(failure.kind).toBe("network");

    const policy = makePolicy({ maxAttempts: 10, circuitBreakerThreshold: 20 });
    expect(policy.decide(failure, 0)).toEqual({
      retry: true,
      delayMs: 100,
      reason: "retryable network failure",
      kind: "network",
    });
    expect(policy.delay(1)).toBe(200);
    expect(policy.delay(2)).toBe(400);
    expect(policy.delay(9)).toBe(1_000);

    const jittered = makePolicy({
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      jitter: 0.5,
      random: () => 1,
    });
    expect(jittered.delay(0)).toBe(1_500);
  });

  test("never retries auth failures", () => {
    const failure = classifyFailure({ status: 401, message: "invalid api key" });
    expect(failure.kind).toBe("auth");
    expect(makePolicy().decide(failure)).toEqual({
      retry: false,
      delayMs: 0,
      reason: "auth failures are not retryable",
      kind: "auth",
    });
  });

  test("compacts once on context overflow, then gives up", () => {
    const failure = classifyFailure({ kind: "context", status: 400 });
    expect(failure.kind).toBe("context");
    const policy = makePolicy();
    expect(policy.decide(failure)).toEqual({
      retry: true,
      delayMs: 0,
      reason: "context overflow, compact and retry",
      kind: "context",
      compact: true,
    });
    expect(policy.decide(failure)).toEqual({
      retry: false,
      delayMs: 0,
      reason: "context failures are not retryable",
      kind: "context",
    });
  });

  test("opens the circuit breaker after repeated retryable failures", () => {
    const failure: RetryFailure = { kind: "server", status: 503 };
    const policy = makePolicy({
      maxAttempts: 10,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownMs: 1_000,
    });

    expect(policy.decide(failure, 0).retry).toBe(true);
    expect(policy.decide(failure, 1)).toEqual({
      retry: false,
      delayMs: 1_000,
      reason: "circuit breaker tripped",
      kind: "server",
    });
    expect(policy.isOpen()).toBe(true);

    clock = 1_000;
    expect(policy.decide(failure, 2).retry).toBe(true);
  });

  test("stops after the retry budget", () => {
    const policy = makePolicy({ maxAttempts: 2 });
    const failure: RetryFailure = { kind: "network" };

    expect(policy.decide(failure, 0).retry).toBe(true);
    expect(policy.decide(failure, 1).retry).toBe(true);
    expect(policy.decide(failure, 2)).toEqual({
      retry: false,
      delayMs: 0,
      reason: "retry budget exhausted after 2 attempts",
      kind: "network",
    });
  });
});

describe("completion signal", () => {
  test("strips a trailing complete block", () => {
    const input = "Implemented and tested.\n\n<complete>Tests pass.</complete>";
    expect(parseCompletionSignal(input)).toEqual({
      text: "Implemented and tested.",
      summary: "Tests pass.",
      complete: true,
    });
  });

  test("supports a multiline summary block and trailing whitespace", () => {
    const input = "Done.\n<summary>\nShipped goal mode.\nChecks pass.\n</summary>\n\n";
    expect(parseCompletionSignal(input)).toEqual({
      text: "Done.",
      summary: "Shipped goal mode.\nChecks pass.",
      complete: true,
    });
  });

  test("ignores a block in the middle of the answer", () => {
    const input = "<complete>done</complete> but then more work happened";
    expect(parseCompletionSignal(input)).toEqual({
      text: input,
      summary: "",
      complete: false,
    });
  });

  test("ignores tags inside fenced code", () => {
    const closed = "Example:\n```\n<complete>done</complete>\n```";
    expect(parseCompletionSignal(closed).complete).toBe(false);

    const unclosed = "Example:\n```\n<complete>done</complete>";
    expect(parseCompletionSignal(unclosed).complete).toBe(false);
  });

  test("matches the outer summary when the body contains native summary tags", () => {
    const input =
      "Done.\n<summary><details><summary>Details</summary><p>Body</p></details></summary>";
    expect(parseCompletionSignal(input)).toEqual({
      text: "Done.",
      summary: "<details><summary>Details</summary><p>Body</p></details>",
      complete: true,
    });
  });

  test("ignores tags inside quoted text", () => {
    const insideQuote = 'He said: "<complete>done</complete>';
    expect(parseCompletionSignal(insideQuote).complete).toBe(false);

    const quotedEarlier = 'Docs mention "<complete>x</complete>".\n<complete>real</complete>';
    expect(parseCompletionSignal(quotedEarlier)).toEqual({
      text: 'Docs mention "<complete>x</complete>".',
      summary: "real",
      complete: true,
    });
  });

  test("ignores a completion tag inside a blockquote", () => {
    expect(parseCompletionSignal("> <complete>done</complete>").complete).toBe(false);
  });
});

describe("goal sources", () => {
  test("do not use regular expressions", async () => {
    const files = ["types.ts", "state.ts", "retry.ts", "completion.ts"];
    const banned = ["RegExp", ".match(", ".test(", ".replace(", ".exec("];
    for (const file of files) {
      const source = await Bun.file(new URL(`../../src/core/goal/${file}`, import.meta.url)).text();
      for (const token of banned) {
        expect(source).not.toContain(token);
      }
    }
  });
});
