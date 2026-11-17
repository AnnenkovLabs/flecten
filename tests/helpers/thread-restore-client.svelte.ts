import { strict as assert } from "node:assert";
import { flushSync } from "svelte";
import { TaskView } from "../../ui/src/lib/run/view.svelte";
import type { AgentEvent, AgentRunResult } from "../../ui/src/lib/types";

const sessionId = "restore-performance";
const timestamp = Date.parse("2026-11-16T00:00:00Z");
const result: AgentRunResult = {
  sessionId,
  pass: true,
  stopReason: "done",
  summary: "Done",
  turns: 1,
  usage: { input: 1, output: 1, cached: 0 },
};

function start(): Extract<AgentEvent, { type: "session.started" }> {
  return {
    type: "session.started",
    sessionId,
    provider: "test",
    model: "test",
    prompt: "Review",
    timestamp,
  };
}

function finish(): Extract<AgentEvent, { type: "session.finished" }> {
  return { type: "session.finished", sessionId, result, timestamp: timestamp + 5000 };
}

function message(text: string): Extract<AgentEvent, { type: "message.finished" }> {
  return { type: "message.finished", sessionId, text, reasoning: "", toolCalls: [] };
}

function restore(events: AgentEvent[]): TaskView {
  const view = new TaskView({ checkpointSaved() {} });
  const started = performance.now();
  view.restore(events);
  const elapsed = performance.now() - started;
  assert(
    elapsed < 2000,
    `Restoring ${events.length} events blocks the renderer for ${Math.round(elapsed)}ms`,
  );
  return view;
}

export function verifyThreadRestore(): void {
  const messages: AgentEvent[] = [];
  for (let index = 0; index < 2000; index += 1)
    messages.push(start(), message(`Answer ${index}`), finish());
  const history = restore(messages);
  assert.equal(history.thread.items.length, 4000);
  const first = history.thread.items[1];
  const last = history.thread.items.at(-1);
  assert(first?.kind === "answer" && first.text === "Answer 0");
  assert(last?.kind === "answer" && last.text === "Answer 1999");

  const tools: AgentEvent[] = [start()];
  for (let index = 0; index < 4000; index += 1) {
    const call = { id: `read-${index}`, name: "read", args: { path: `file-${index}.ts` } };
    tools.push(
      { type: "turn.started", sessionId, turn: index + 1, timestamp: timestamp + index },
      {
        type: "message.finished",
        sessionId,
        text: "",
        reasoning: "Checked file",
        toolCalls: [call],
      },
      { type: "tool.started", sessionId, call },
      {
        type: "tool.finished",
        sessionId,
        call,
        result: { ok: true, output: "Saved result", durationMs: 1 },
      },
    );
  }
  tools.push(message("Final answer"), finish());
  const completed = restore(tools);
  const run = completed.thread.items.find((item) => item.kind === "run");
  assert(run?.kind === "run");
  assert.equal(run.summary.live, false);
  assert.equal(run.summary.list.length, 4000);
  assert.equal(run.summary.turns.length, 4000);
  assert.equal(run.summary.list.at(-1)?.detail?.output, "Saved result");

  const inserted = restore([
    { ...start(), internal: true },
    { type: "message.delta", sessionId, text: "Early answer" },
    { type: "reasoning.delta", sessionId, text: "Thinking", timestamp },
  ]);
  inserted.apply({ type: "message.delta", sessionId, text: " continued" });
  inserted.apply(message("Final after insertion"));
  inserted.apply(finish());
  assert.deepEqual(
    inserted.thread.items.map((item) => item.kind),
    ["run", "answer"],
  );
  const insertedAnswer = inserted.thread.items[1];
  assert(insertedAnswer?.kind === "answer" && insertedAnswer.text === "Final after insertion");

  // A partial replay must publish its latest turn and remain reactive to the live tail.
  const live = restore(tools.slice(0, -2));
  let rendered = "";
  let action = "continue";
  const dispose = $effect.root(() => {
    $effect(() => {
      rendered = live.thread.items
        .map((item) =>
          item.kind === "run"
            ? `${item.summary.actions}:${item.summary.live}`
            : item.kind === "answer"
              ? item.text
              : "",
        )
        .join("|");
      const notice = live.thread.items.find((item) => item.kind === "notice");
      action = notice?.kind === "notice" ? (notice.action ?? "settled") : "none";
    });
  });
  try {
    flushSync();
    assert(rendered.includes("4000:true"));
    live.apply({ type: "message.delta", sessionId, text: "Streamed answer" });
    flushSync();
    assert(rendered.endsWith("Streamed answer"));
    live.apply(message("Finished answer"));
    live.apply(finish());
    flushSync();
    assert(rendered.includes("4000:false"));
    assert(rendered.endsWith("Finished answer"));
    live.apply({ type: "run.interrupted", sessionId, at: timestamp, reason: "stopped" });
    flushSync();
    assert.equal(action, "continue");
    live.apply(start());
    flushSync();
    assert.equal(action, "settled");
    live.apply({ type: "message.delta", sessionId, text: "Next run" });
    flushSync();
    assert(rendered.endsWith("Next run"));
  } finally {
    dispose();
  }
}
