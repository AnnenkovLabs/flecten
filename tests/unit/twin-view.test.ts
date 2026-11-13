import { expect, test } from "bun:test";
import type { TwinActivity } from "../../shared/twin-activity";
import "../helpers/svelte-runes";

const { TaskView } = await import("../../ui/src/lib/run/view.svelte");

test("Twin dialogue replays through the real task view, settles running states and resets with the task", () => {
  const view = new TaskView({ checkpointSaved() {} });
  const activity: TwinActivity = {
    phase: "final",
    state: "running",
    emotion: "calm",
    voice: "",
    instructions: "",
    entryIds: [],
    corrections: 0,
    provider: "test",
    model: "model",
  };
  view.apply({ type: "twin.activity", sessionId: "task", activity });
  expect(view.twin.busy).toBe(true);
  view.apply({
    type: "twin.activity",
    sessionId: "task",
    activity: {
      ...activity,
      state: "revise",
      emotion: "angry",
      voice: "Снова не то. Сделай как просил.",
      instructions: "Use the requested structure.",
      corrections: 1,
      usage: { input: 20, output: 10, cached: 5 },
    },
  });
  expect(view.twin.items).toHaveLength(1);
  expect(view.twin.latest?.voice).toBe("Снова не то. Сделай как просил.");
  expect(view.twin.busy).toBe(false);
  expect(view.usage.total).toMatchObject({ input: 20, output: 10, cached: 5 });
  view.apply({
    type: "twin.activity",
    sessionId: "task",
    activity: { ...activity, phase: "question" },
  });
  view.coreLost();
  expect(view.twin.latest?.state).toBe("cancelled");
  view.reset();
  expect(view.twin.items).toHaveLength(0);
});
