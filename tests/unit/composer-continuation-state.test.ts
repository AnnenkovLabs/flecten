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
  prompt: "/continue",
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
  view.begin("/continue");
  expect(view.resumable).toBe(false);
  view.apply(started);
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
    view.begin("/continue");
    expect(view.resumable).toBe(false);
    view.apply(started);
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
