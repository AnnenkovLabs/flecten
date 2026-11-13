import { expect, test } from "bun:test";
import { HookRunSchema } from "../../shared/hooks";
import { TaskView } from "../../ui/src/lib/run/view.svelte";

const event = (index: number) => ({
  type: "hook.finished" as const,
  sessionId: "s_history",
  hook: HookRunSchema.parse({
    event: "preToolUse",
    index,
    id: "format",
    name: "Format changes",
    ok: false,
    blocked: true,
    durationMs: 12,
    exitCode: 2,
    timedOut: false,
    aborted: false,
  }),
});

test("the selected task projects live and replayed hook diagnostics and clears them on navigation", () => {
  const live = new TaskView({ checkpointSaved() {} });
  for (let index = 0; index < 55; index++) live.apply(event(index));
  expect(live.hookRuns).toHaveLength(50);
  expect(live.hookRuns[0]?.index).toBe(5);
  expect(live.hookRuns.at(-1)).toMatchObject({
    id: "format",
    name: "Format changes",
    blocked: true,
    exitCode: 2,
  });
  const replayed = new TaskView({ checkpointSaved() {} });
  replayed.restore([event(54)]);
  expect(replayed.hookRuns).toEqual([event(54).hook]);
  live.reset();
  expect(live.hookRuns).toEqual([]);
});
