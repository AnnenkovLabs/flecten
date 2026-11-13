import { expect, test } from "bun:test";
import { costOf } from "../../src/app/provider-state";
import { addUsage } from "../../src/core/types/message";
import { sessionUsageCost } from "../../ui/src/lib/run/token-usage";
import type { AgentEvent } from "../../ui/src/lib/types";
import "../helpers/svelte-runes";

const { TaskView } = await import("../../ui/src/lib/run/view.svelte");

test("task context details accumulate live usage, replay it once, and keep occupancy separate", () => {
  const sessionId = "tokens";
  const reading = { used: 8000, window: 100000, reserve: 0, source: "provider" as const };
  const budget = (costUsd: number) => ({
    limits: {},
    spent: { tokens: 0, costUsd, wallClockMs: 0 },
    remaining: {},
  });
  const events: AgentEvent[] = [
    { type: "session.started", sessionId, provider: "p", model: "main" },
    { type: "turn.started", sessionId, turn: 1 },
    {
      type: "usage",
      sessionId,
      usage: { input: 6000, output: 2000, cached: 3000, reasoning: 800, cacheWrite: 1000 },
    },
    { type: "budget", sessionId, budget: budget(0.02) },
    { type: "context.usage", sessionId, ...reading },
    { type: "turn.started", sessionId, turn: 2 },
    {
      type: "usage",
      sessionId,
      provider: "translate",
      model: "translator",
      purpose: "translation",
      usage: { input: 400, output: 100, cached: 0 },
    },
    { type: "budget", sessionId, budget: budget(0.03) },
    {
      type: "usage",
      sessionId,
      provider: "fallback",
      model: "other",
      usage: { input: 2000, output: 500, cached: 100, reasoning: 200 },
    },
    { type: "budget", sessionId, budget: budget(0.05) },
    { type: "session.started", sessionId, provider: "p", model: "main" },
    { type: "turn.started", sessionId, turn: 1 },
    { type: "usage", sessionId, usage: { input: 1000, output: 100, cached: 0, cacheWrite: 0 } },
    { type: "budget", sessionId, budget: budget(0.01) },
  ];
  const live = new TaskView({ checkpointSaved() {} });
  for (const event of events) live.apply(event as Parameters<typeof live.apply>[0]);
  const restored = new TaskView({ checkpointSaved() {} });
  restored.restore(events);
  expect(restored.usage).toEqual(live.usage);
  expect(live.usage.total).toEqual({
    input: 9400,
    output: 2700,
    cached: 3100,
    reasoning: 1000,
    cacheWrite: 1000,
  });
  expect(live.usage.models.map(({ model, input }) => [model, input])).toEqual([
    ["main", 7000],
    ["translator", 400],
    ["other", 2000],
  ]);
  expect(sessionUsageCost(live.usage)).toBeCloseTo(0.06);
  expect(live.usage.lastTurnCost).toBeCloseTo(0.01);
  expect(live.context.view(0).percent).toBe(8);
  live.context.apply({ ...reading, used: 56000, reserve: 20000 });
  expect(live.context.view(0)).toMatchObject({ window: 80000, percent: 70, autoAt: 100 });
  live.apply({ type: "usage", sessionId, usage: { input: 10, output: 2, cached: 0 } });
  live.apply({
    type: "budget",
    sessionId,
    budget: { limits: {}, spent: { tokens: 12, wallClockMs: 0 }, remaining: {} },
  });
  expect(sessionUsageCost(live.usage)).toBeUndefined();
  expect(live.usage.models[0]?.cost).toBeUndefined();
  live.reset();
  expect(live.usage.models).toEqual([]);
  expect(live.usage.total.input).toBe(0);
});

test("cache writes survive accumulation and use their configured price", () => {
  const usage = addUsage(
    { input: 0, output: 0, cached: 0 },
    { input: 1000, output: 100, cached: 400, reasoning: 50, cacheWrite: 300 },
  );
  expect(usage.cacheWrite).toBe(300);
  expect(usage.reasoning).toBe(50);
  expect(
    costOf(usage, { cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } }),
  ).toBeCloseTo(0.00243);
  expect(costOf(usage, { cost: { input: 0, output: 0 } })).toBe(0);
});
