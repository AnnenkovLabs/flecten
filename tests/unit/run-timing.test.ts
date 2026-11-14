import { expect, spyOn, test } from "bun:test";
import { EventJournal } from "../../src/app/event-journal";
import { formatDuration } from "../../ui/src/lib/agent";
import { attachedEvents } from "../../ui/src/lib/run/attach";
import type { SessionEvent } from "../../ui/src/lib/run/view.svelte";
import type { AgentEvent, AgentRunResult } from "../../ui/src/lib/types";
import "../helpers/svelte-runes";

const { TaskView } = await import("../../ui/src/lib/run/view.svelte");
const sessionId = "timed-chat";
const result: AgentRunResult = {
  sessionId,
  pass: true,
  stopReason: "done",
  summary: "Done",
  turns: 1,
  usage: { input: 1, output: 1, cached: 0 },
};

function summary(view: InstanceType<typeof TaskView>) {
  const item = view.thread.items.findLast((item) => item.kind === "run");
  if (item?.kind !== "run") throw new Error("Run summary missing");
  return item.summary;
}

test("returning to a live chat preserves the time elapsed before and during navigation", () => {
  const start = Date.parse("2026-11-14T00:00:00Z");
  let now = start;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const journal = new EventJournal();
    const view = new TaskView({ checkpointSaved() {} });
    view.begin("Keep thinking");
    for (const event of journal.accept({
      type: "session.started",
      sessionId,
      provider: "test",
      model: "test",
      prompt: "Keep thinking",
    }))
      view.apply(event as SessionEvent);
    journal.accept({ type: "turn.started", sessionId, turn: 1 });
    now += 1000;
    const reasoning = journal.stamp({ type: "reasoning.delta", sessionId, text: "Thinking" });
    view.apply(reasoning as SessionEvent);
    now = start + 45_000;
    view.reset("Other chat");
    view.reset("Keep thinking");
    view.restore(attachedEvents([], journal.replay(sessionId)));
    expect(summary(view).duration).toBe(formatDuration(45_000));
    expect(summary(view).live).toBe(true);
    now += 5000;
    view.apply(
      journal.stamp({ type: "reasoning.delta", sessionId, text: " more" }) as SessionEvent,
    );
    expect(summary(view).duration).toBe(formatDuration(50_000));
    view.apply(journal.stamp({ type: "session.finished", sessionId, result }) as SessionEvent);
    expect(summary(view).turns[0]?.reasoningMs).toBe(49_000);
  } finally {
    clock.mockRestore();
  }
});

test("opening a completed chat uses its finish time instead of the time of replay", () => {
  const start = Date.parse("2026-11-14T00:00:00Z");
  let now = start;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const journal = new EventJournal();
    journal.stamp({
      type: "session.started",
      sessionId,
      provider: "test",
      model: "test",
      prompt: "Finish",
    });
    journal.stamp({ type: "turn.started", sessionId, turn: 1 });
    now += 10_000;
    journal.stamp({ type: "reasoning.delta", sessionId, text: "Thought" });
    now += 35_000;
    journal.stamp({
      type: "message.finished",
      sessionId,
      text: "Done",
      reasoning: "Thought",
      toolCalls: [],
    });
    journal.stamp({ type: "session.finished", sessionId, result });
    now += 3_600_000;
    const view = new TaskView({ checkpointSaved() {} });
    view.restore(journal.replay(sessionId).events as AgentEvent[]);
    expect(summary(view).duration).toBe(formatDuration(45_000));
    expect(summary(view).live).toBe(false);
    expect(summary(view).turns[0]?.reasoningMs).toBe(35_000);
  } finally {
    clock.mockRestore();
  }
});
