import { expect, test } from "bun:test";
import type { TwinActivity, TwinActivityEvent } from "../../shared/twin-activity";
import { RunSpend } from "../../src/app/run-spend";
import { RunBudget } from "../../src/core/session/budget";

function activity(taskId: string, values: Partial<TwinActivity> = {}): TwinActivityEvent {
  return {
    type: "twin.activity",
    sessionId: "task",
    activity: {
      taskId,
      phase: "prepare",
      state: "running",
      emotion: "calm",
      voice: "",
      instructions: "",
      entryIds: [],
      corrections: 0,
      provider: "provider",
      model: "model",
      ...values,
    },
  };
}

function pricedRun(spend: RunSpend, worker: boolean, cost: number): void {
  const sessionId = worker ? "task_worker" : "task";
  const started = {
    type: "session.started" as const,
    sessionId,
    provider: "provider",
    model: "model",
    prompt: "Build checkout",
  };
  const budget = new RunBudget({}, () => cost);
  budget.add({ input: 10, output: 5, cached: 0 });
  const priced = { type: "budget" as const, sessionId, budget: budget.view() };
  if (worker) {
    spend.note({ type: "worker.event", sessionId: "task", event: started });
    spend.note({ type: "worker.event", sessionId: "task", event: priced });
  } else {
    spend.note(started);
    spend.note(priced);
  }
}

test("Restarting Twin preparation retains the billed cancelled review and every Worker correction", () => {
  const spend = new RunSpend();
  pricedRun(spend, false, 1);
  spend.note(activity("first"));
  spend.note(
    activity("first", {
      state: "cancelled",
      usage: { input: 10, output: 5, cached: 0, costUsd: 2 },
    }),
  );
  spend.note(activity("first"));
  spend.note(
    activity("first", {
      state: "revise",
      usage: { input: 10, output: 5, cached: 0, costUsd: 3 },
    }),
  );
  pricedRun(spend, true, 4);
  pricedRun(spend, true, 5);
  expect(spend.get("task")?.cost).toBe(15);
});

test("A late cancelled review belongs to its original task and unknown prices remain unknown", () => {
  const spend = new RunSpend();
  pricedRun(spend, false, 1);
  spend.note(activity("first"));
  spend.note(activity("second"));
  spend.note(
    activity("first", {
      state: "cancelled",
      usage: { input: 10, output: 5, cached: 0, costUsd: 9 },
    }),
  );
  spend.note(
    activity("second", {
      state: "revise",
      usage: { input: 10, output: 5, cached: 0, costUsd: 2 },
    }),
  );
  expect(spend.get("task")?.cost).toBe(3);
  spend.note(activity("second", { state: "error", usage: { input: 10, output: 5, cached: 0 } }));
  expect(spend.get("task")?.cost).toBeUndefined();
});
