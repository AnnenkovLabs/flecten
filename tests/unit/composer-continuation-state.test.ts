import { expect, test } from "bun:test";
import { SessionStateSchema } from "../../shared/session-state";
import type { AgentRunResult } from "../../ui/src/lib/agent-types";
import { type SessionEvent, TaskView } from "../../ui/src/lib/run/view.svelte";

const idle = SessionStateSchema.parse({
  sessionId: "parent",
  epoch: "core",
  revision: 1,
  phase: "idle",
  running: false,
  interrupted: false,
  turns: 1,
  queue: [],
  approvals: [],
  jobs: [],
});
const started = {
  type: "session.started" as const,
  sessionId: "parent",
  provider: "test",
  model: "test",
  prompt: "Fix the build",
};
const continued = {
  ...started,
  prompt: "/continue",
  continuation: true,
};
const result: AgentRunResult = {
  sessionId: "child",
  stopReason: "stopped",
  pass: false,
  turns: 1,
  summary: "Stopped",
  usage: { input: 1, output: 1, cached: 0 },
};
const worker = (event: Extract<SessionEvent, { type: "worker.event" }>["event"]) => ({
  type: "worker.event" as const,
  sessionId: "parent",
  event,
});

test("Continue follows the canonical stop state and stays unavailable during the graceful wait", () => {
  const view = new TaskView({ checkpointSaved() {} });
  expect(view.resumable).toBe(false);
  view.applyState(idle);
  expect(view.resumable).toBe(false);
  view.applyState({ ...idle, revision: 2, phase: "running", running: true, stopRequested: true });
  expect(view.stopping).toBe(true);
  expect(view.resumable).toBe(false);
  view.applyState({ ...idle, revision: 3, phase: "stopped" });
  expect(view.resumable).toBe(true);
  view.beginContinuation();
  expect(view.resumable).toBe(false);
  view.apply(continued);
  view.applyState({ ...idle, revision: 4 });
  expect(view.resumable).toBe(false);
  view.applyState({ ...idle, revision: 5, phase: "failed" });
  expect(view.resumable).toBe(true);
});

test("reopened interrupted tasks offer Continue and reset clears it", () => {
  const view = new TaskView({ checkpointSaved() {} });
  view.restore([
    started,
    { type: "run.interrupted", sessionId: "parent", at: 1, reason: "core stopped" },
  ]);
  view.applyState({ ...idle, phase: "stopped", interrupted: true });
  expect(view.resumable).toBe(true);
  view.reset();
  expect(view.resumable).toBe(false);
});

test("stopping before Worker starts unlocks the composer live and after replay", () => {
  const events: SessionEvent[] = [
    started,
    {
      type: "session.state",
      sessionId: "parent",
      state: { ...idle, phase: "running", running: true, stopRequested: true },
    },
    worker({
      type: "session.state",
      sessionId: "child",
      state: { ...idle, sessionId: "child" },
    }),
    {
      type: "session.finished",
      sessionId: "parent",
      result: { ...result, sessionId: "parent" },
    },
    {
      type: "session.state",
      sessionId: "parent",
      state: { ...idle, revision: 2, phase: "stopped" },
    },
  ];
  for (const replay of [false, true]) {
    const view = new TaskView({ checkpointSaved() {} });
    if (replay) view.restore(events);
    else for (const event of events) view.apply(event);
    expect(view.phase).toBe("stopped");
    expect(view.busy).toBe(false);
    expect(view.resumable).toBe(true);
    expect(view.worker.items).toHaveLength(0);
  }
});

test("Worker stop or crash offers Continue with an idle Talker and settles on a new user run", () => {
  for (const boundary of [
    worker({ type: "session.finished", sessionId: "child", result }),
    worker({
      type: "session.finished",
      sessionId: "child",
      result: { ...result, stopReason: "error" },
    }),
    worker({ type: "run.interrupted", sessionId: "child", at: 1, reason: "core stopped" }),
  ]) {
    const view = new TaskView({ checkpointSaved() {} });
    const events = [worker({ ...started, sessionId: "child" }), boundary];
    view.applyState(idle);
    view.restore(events);
    expect(view.phase).toBe("idle");
    expect(view.busy).toBe(false);
    expect(view.resumable).toBe(true);
    view.beginContinuation();
    expect(view.resumable).toBe(false);
    view.apply(continued);
    view.applyState({ ...idle, revision: 2 });
    expect(view.resumable).toBe(false);
    view.apply(worker({ ...started, sessionId: "child" }));
    expect(view.resumable).toBe(false);
    view.apply(boundary);
    expect(view.resumable).toBe(true);
  }
});

test("a completed Worker never offers Continue", () => {
  const view = new TaskView({ checkpointSaved() {} });
  view.applyState(idle);
  view.restore([
    worker({ ...started, sessionId: "child" }),
    worker({
      type: "session.finished",
      sessionId: "child",
      result: { ...result, stopReason: "done", pass: true },
    }),
  ]);
  expect(view.resumable).toBe(false);
});

test("Continue resumes a stopped run seamlessly without adding /continue to the thread (live and replay)", () => {
  const call1 = { id: "c1", name: "read", args: { path: "README.md" } };
  const call2 = { id: "c2", name: "grep", args: { pattern: "test" } };
  const events: SessionEvent[] = [
    { ...started, timestamp: 1_000 },
    { type: "turn.started", sessionId: "parent", turn: 1, timestamp: 1_100 },
    { type: "reasoning.delta", sessionId: "parent", text: "First thought", timestamp: 1_200 },
    { type: "tool.started", sessionId: "parent", call: call1, timestamp: 1_300 },
    {
      type: "tool.finished",
      sessionId: "parent",
      call: call1,
      result: { ok: true, output: "readme" },
      timestamp: 2_000,
    },
    {
      type: "session.finished",
      sessionId: "parent",
      result: { ...result, sessionId: "parent", summary: "" },
      timestamp: 4_000,
    },
    { ...continued, timestamp: 24_000 },
    { type: "turn.started", sessionId: "parent", turn: 1, timestamp: 24_100 },
    { type: "reasoning.delta", sessionId: "parent", text: "Second thought", timestamp: 24_200 },
    { type: "tool.started", sessionId: "parent", call: call2, timestamp: 24_300 },
    {
      type: "tool.finished",
      sessionId: "parent",
      call: call2,
      result: { ok: true, output: "match" },
      timestamp: 25_000,
    },
    {
      type: "message.finished",
      sessionId: "parent",
      text: "Done checking.",
      reasoning: "Second thought",
      toolCalls: [],
      timestamp: 26_000,
    },
    {
      type: "session.finished",
      sessionId: "parent",
      result: { ...result, sessionId: "parent", stopReason: "done", pass: true, summary: "" },
      timestamp: 26_000,
    },
  ];

  for (const replay of [false, true]) {
    const view = new TaskView({ checkpointSaved() {} });
    if (replay) {
      view.restore(events);
    } else {
      for (const event of events) {
        if (event === continued) view.beginContinuation();
        view.apply(event);
      }
    }
    const messages = view.thread.items.filter((item) => item.kind === "message");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("Fix the build");
    expect(view.lastPrompt).toBe("Fix the build");
    expect(view.title).toBe("Fix the build");
    const runs = view.thread.items.filter((item) => item.kind === "run");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.summary.stopped).toBe(false);
    expect(runs[0]?.summary.failed).toBe(false);
    expect(runs[0]?.summary.actions).toBe(2);
    expect(runs[0]?.summary.turns.map((turn) => turn.index)).toEqual([1, 2]);
    expect(runs[0]?.summary.turns.map((turn) => turn.reasoning)).toEqual([
      "First thought",
      "Second thought",
    ]);
    expect(runs[0]?.summary.prompt).toBe("Fix the build");
    const answers = view.thread.items.filter((item) => item.kind === "answer");
    expect(answers).toHaveLength(1);
    expect(answers[0]?.text).toBe("Done checking.");
  }
});

test("failed optimistic continuation preserves the user message and restores the stopped run", () => {
  const view = new TaskView({ checkpointSaved() {} });
  view.apply({ ...started, timestamp: 1_000 });
  view.apply({
    type: "tool.started",
    sessionId: "parent",
    call: { id: "c1", name: "read", args: { path: "a.ts" } },
    timestamp: 1_100,
  });
  view.apply({
    type: "session.finished",
    sessionId: "parent",
    result: { ...result, sessionId: "parent", summary: "" },
    timestamp: 2_000,
  });
  view.beginContinuation();
  const runBefore = view.thread.items.find((item) => item.kind === "run");
  expect(runBefore?.summary.live).toBe(true);
  view.failed("bridge offline", "bridge");
  const messages = view.thread.items.filter((item) => item.kind === "message");
  expect(messages).toHaveLength(1);
  expect(messages[0]?.text).toBe("Fix the build");
  const runAfter = view.thread.items.find((item) => item.kind === "run");
  expect(runAfter?.summary.live).toBe(false);
  expect(runAfter?.summary.stopped).toBe(true);
});

test("Talker/Worker continuation routes to Worker without adding /continue or duplicating Worker cards", () => {
  const view = new TaskView({ checkpointSaved() {} });
  view.apply({ ...started, role: "talker", timestamp: 1_000 });
  view.apply({ ...worker({ ...started, sessionId: "child" }), timestamp: 1_100 });
  view.apply({
    type: "session.finished",
    sessionId: "parent",
    result: { ...result, sessionId: "parent", stopReason: "end", pass: true, summary: "" },
    timestamp: 1_200,
  });
  view.apply({
    ...worker({ type: "session.finished", sessionId: "child", result }),
    timestamp: 2_000,
  });
  expect(view.resumable).toBe(true);

  view.beginContinuation();
  expect(view.pendingSend).toBe(true);
  view.apply({ ...worker({ ...continued, sessionId: "child" }), timestamp: 5_000 });
  expect(view.pendingSend).toBe(false);
  expect(view.live).toBe(false);
  expect(view.busy).toBe(true);
  expect(view.worker.items).toHaveLength(1);
  expect(view.worker.items[0]?.status).toBe("running");
  expect(view.thread.items.filter((item) => item.kind === "message")).toHaveLength(1);
});
