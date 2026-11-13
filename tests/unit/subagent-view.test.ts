import { expect, test } from "bun:test";
import { EventJournal } from "../../src/app/event-journal";
import type { Event } from "../../src/core/types";
import { TaskView } from "../../ui/src/lib/run/view.svelte";
import type { AgentEvent } from "../../ui/src/lib/types";

test.each([false, true])(
  "child identity and live activity survive parent stop and replay; worker=%s",
  (worker) => {
    const view = new TaskView({ checkpointSaved() {} });
    const info = {
      id: "sa_one",
      callId: "task",
      name: "Milo",
      avatar: 0,
      agent: "explore",
      prompt: "exact\n  source",
    };
    const wrap = (event: AgentEvent): AgentEvent =>
      worker
        ? {
            type: "worker.event",
            sessionId: "parent",
            event: event as Extract<AgentEvent, { type: "worker.event" }>["event"],
          }
        : event;
    const events: AgentEvent[] = [
      {
        type: "session.started",
        sessionId: "parent",
        provider: "test",
        model: "test",
        prompt: "work",
      },
      wrap({
        type: "tool.started",
        sessionId: "parent",
        call: { id: "task", name: "task", args: { agent: "explore", prompt: info.prompt } },
      }),
      wrap({ type: "subagent.started", sessionId: "parent", subagent: info }),
      {
        type: "session.finished",
        sessionId: "parent",
        result: {
          sessionId: "parent",
          pass: false,
          stopReason: "stopped",
          summary: "",
          turns: 1,
          usage: { input: 0, output: 0, cached: 0 },
        },
      },
      wrap({
        type: "subagent.event",
        sessionId: "parent",
        id: info.id,
        event: {
          type: "tool.started",
          sessionId: "child",
          call: { id: "read", name: "read", args: { path: "README.md" } },
        },
      }),
    ];
    view.restore(events);
    expect(view.subagents.items[0]).toMatchObject({ ...info, status: "running" });
    expect(
      view.subagents.items[0]?.thread.items.some(
        (item) => item.kind === "run" && item.summary.list[0]?.running,
      ),
    ).toBe(true);
    const child = view.subagents.items[0];
    if (!child) throw new Error("No child view");
    const action = view.subagents.action(child);
    expect(action.running).toBe(true);
    expect(action.subagent?.name).toBe("Milo");
    const finished = wrap({
      type: "subagent.finished",
      sessionId: "parent",
      id: info.id,
      cancelled: false,
      result: {
        ok: false,
        summary: "Ready.",
        usage: { input: 1, output: 1, cached: 0 },
        error: "Invalid report: files is required",
      },
    });
    view.restore([finished]);
    const replay = new TaskView({ checkpointSaved() {} });
    replay.restore([...events, finished]);
    expect(replay.subagents.items[0]).toMatchObject({
      ...info,
      status: "failed",
      result: { error: "Invalid report: files is required" },
    });
    const restored = replay.subagents.items[0];
    if (!restored) throw new Error("No restored child");
    expect(replay.subagents.action(restored).failed).toBe(true);
  },
);

test("nested child streams redact split secrets independently and retain sibling progress", () => {
  const journal = new EventJournal(() => ["secret-123456"]);
  journal.accept({
    type: "session.started",
    sessionId: "parent",
    provider: "test",
    model: "test",
    prompt: "work",
  });
  const nested = (id: string, text: string): Event => ({
    type: "worker.event",
    sessionId: "parent",
    event: {
      type: "subagent.event",
      sessionId: "worker",
      id,
      event: { type: "message.delta", sessionId: id, text },
    },
  });
  const emitted = [
    ...journal.accept(nested("one", "secret-")),
    ...journal.accept(nested("two", "sibling progress ")),
    ...journal.accept(nested("one", "123456")),
  ];
  emitted.push(
    ...journal.accept({
      type: "worker.event",
      sessionId: "parent",
      event: {
        type: "subagent.event",
        sessionId: "worker",
        id: "one",
        event: {
          type: "message.finished",
          sessionId: "one",
          text: "secret-123456",
          reasoning: "",
          toolCalls: [],
        },
      },
    }),
  );
  expect(JSON.stringify(emitted)).not.toContain("secret-123456");
  expect(JSON.stringify(journal.replay("parent"))).toContain("sibling progress");
});
