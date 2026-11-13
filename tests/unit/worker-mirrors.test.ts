import { expect, test } from "bun:test";
import { SessionStateSchema } from "../../shared/session-state";
import { WorkerReferences } from "../../src/app/worker-references";
import type { Event } from "../../src/core/types";
import { toolReferences } from "../../ui/src/lib/markdown/tool-references";
import { type SessionEvent, TaskView } from "../../ui/src/lib/run/view.svelte";
import { conversationItems, workerMirrors } from "../../ui/src/lib/run/worker-mirrors";

const call = { id: "provider-id", name: "bash", args: { command: "bun test" } };
const parent = "parent";
const child = "child";
const wrap = (event: Exclude<Event, { type: "worker.event" }>) => ({
  type: "worker.event" as const,
  sessionId: parent,
  event,
});

test("Worker keeps the composer busy and exposes graceful stop while Talker is idle", () => {
  const view = new TaskView({ checkpointSaved() {} });
  const state = SessionStateSchema.parse({
    sessionId: parent,
    epoch: "talker",
    revision: 1,
    phase: "idle",
    running: false,
    interrupted: false,
    turns: 1,
    queue: [],
    approvals: [],
    jobs: [],
  });
  view.applyState(state);
  view.apply(
    wrap({
      type: "session.started",
      sessionId: child,
      provider: "test",
      model: "test",
      prompt: "Verify project",
    }),
  );
  expect(view.phase).toBe("idle");
  expect(view.busy).toBe(true);
  expect(view.stopping).toBe(false);
  const stopped = wrap({
    type: "session.state",
    sessionId: child,
    state: {
      ...state,
      sessionId: child,
      epoch: "worker",
      phase: "running",
      running: true,
      stopRequested: true,
    },
  });
  view.apply(stopped);
  expect(view.stopping).toBe(true);
  view.applyState({ ...state, revision: 2 });
  expect(view.stopping).toBe(true);
  const restored = new TaskView({ checkpointSaved() {} });
  restored.restore([stopped]);
  expect(restored.busy).toBe(true);
  expect(restored.stopping).toBe(true);
  view.coreLost();
  expect(view.busy).toBe(false);
  expect(view.stopping).toBe(false);
});

test("reference parser resolves known prose references and preserves code, links, escapes and unknown IDs", () => {
  const known = new Set(["w_id"]);
  const source =
    "Проверяем:\n\n[[w_id]]\n\n`[[w_id]]`\n\n```text\n[[w_id]]\n```\n\n[link](https://example.test/[[w_id]])\n\n[[unknown]]";
  expect(toolReferences(source, known).filter((part) => part.kind === "tool")).toEqual([
    { kind: "tool", id: "w_id" },
  ]);
  expect(toolReferences("\\[\\[w_id]]", known)).toEqual([
    { kind: "markdown", text: "\\[\\[w_id]]" },
  ]);
});

test("live and replayed projection share one canonical object and keep Worker approvals independent of Talker state", () => {
  const view = new TaskView({ checkpointSaved() {} });
  const started = wrap({ type: "tool.started", sessionId: child, call });
  view.apply(started);
  const item = view.thread.items.find((entry) => entry.kind === "worker");
  if (item?.kind !== "worker") throw new Error("missing worker activity");
  const mirrored = item.actions[0];
  view.apply(
    wrap({ type: "tool.output", sessionId: child, callId: call.id, text: "live output\n" }),
  );
  expect(mirrored?.detail?.output).toBe("live output\n");
  const finished = wrap({
    type: "tool.finished",
    sessionId: child,
    call,
    result: { ok: true, output: "finished", durationMs: 20 },
  });
  view.apply(finished);
  const completed = item.actions[0];
  expect(completed?.id).toBe(mirrored?.id);
  expect(completed?.detail?.output).toBe("finished");
  expect(completed?.running ?? false).toBe(false);
  const restored = new TaskView({ checkpointSaved() {} });
  restored.restore([started, finished]);
  expect(restored.thread.items.find((entry) => entry.kind === "worker")).toMatchObject({
    actions: [{ id: call.id, detail: { output: "finished" } }],
  });
});

test("provider reuse gets a new scoped reference, while live and durable events use the same reference", () => {
  const ids = new WorkerReferences();
  const input: Event = {
    type: "message.finished",
    sessionId: child,
    text: "",
    reasoning: "",
    toolCalls: [call],
  };
  const message = ids.event(input);
  const first = ids.event({ type: "tool.started", sessionId: child, call });
  if (message.type !== "message.finished" || first.type !== "tool.started")
    throw new Error("wrong event");
  const messageCall = message.toolCalls[0];
  if (!messageCall) throw new Error("missing tool call");
  expect(first.call.id).toBe(messageCall.id);
  expect(ids.event(input)).toBe(message);
  const second = ids.event({ ...input });
  if (second.type !== "message.finished") throw new Error("wrong event");
  expect(second.toolCalls[0]?.id).not.toBe(first.call.id);
});

test("a Talker state snapshot does not resolve a pending Worker approval", () => {
  const view = new TaskView({ checkpointSaved() {} });
  view.apply(
    wrap({
      type: "approval.requested",
      sessionId: child,
      approval: {
        id: "approval-worker",
        action: "shell",
        tool: "bash",
        target: "bun test",
        reason: "permission required",
        createdAt: 1,
        expiresAt: 10000,
      },
    }),
  );
  view.applyState({
    sessionId: parent,
    epoch: "talker",
    revision: 1,
    phase: "idle",
    running: false,
    interrupted: false,
    turns: 0,
    queue: [],
    approvals: [],
    jobs: [],
  });
  expect(view.thread.items.find((item) => item.kind === "approval")).toMatchObject({
    state: "pending",
    owner: "worker",
    sessionId: parent,
  });
});

test("every Worker call appears without Talker references, including fast calls, and explicit mirrors replace automatic ones", () => {
  const view = new TaskView({ checkpointSaved() {} });
  const calls = [call, { ...call, id: "fast", name: "read", args: { path: "README.md" } }];
  const events = calls.flatMap((entry) => [
    wrap({ type: "tool.started", sessionId: child, call: entry }),
    wrap({
      type: "tool.finished",
      sessionId: child,
      call: entry,
      result: { ok: true, output: entry.id },
    }),
  ]);
  for (const event of events) view.apply(event);
  const project = (task: TaskView) =>
    conversationItems(task.thread.items, workerMirrors(task.thread.items));
  expect(
    project(view)
      .filter((item) => item.kind === "worker-tool")
      .map((item) => item.reference),
  ).toEqual(calls.map((entry) => entry.id));
  expect(project(view).some((item) => item.kind === "worker")).toBe(false);
  expect(view.worker.items[0]?.actions).toHaveLength(2);
  const restored = new TaskView({ checkpointSaved() {} });
  restored.restore(events);
  expect(project(restored).filter((item) => item.kind === "worker-tool")).toHaveLength(2);
  view.thread.push({
    kind: "answer",
    id: "answer",
    text: `Checking:\n\n[[${call.id}]]\n\n\`[[fast]]\``,
  });
  expect(project(view).filter((item) => item.kind === "worker-tool")).toMatchObject([
    { reference: "fast" },
  ]);
  expect(workerMirrors(view.thread.items).get(call.id)).toBe(view.worker.items[0]?.actions[0]);
});

test("Talker messages keep their text and chronological position between Worker calls, live and after replay", () => {
  const events: SessionEvent[] = [
    { type: "turn.started", sessionId: parent, turn: 1 },
    { type: "message.delta", sessionId: parent, text: "Сначала проверю документацию." },
    {
      type: "message.finished",
      sessionId: parent,
      text: "Сначала проверю документацию.",
      reasoning: "",
      toolCalls: [],
    },
    wrap({ type: "tool.started", sessionId: child, call }),
    wrap({ type: "tool.finished", sessionId: child, call, result: { ok: true, output: "read" } }),
    { type: "turn.started", sessionId: parent, turn: 2 },
    { type: "message.delta", sessionId: parent, text: "Теперь сверяю реализацию." },
    {
      type: "message.finished",
      sessionId: parent,
      text: "Теперь сверяю реализацию.",
      reasoning: "",
      toolCalls: [],
    },
    wrap({ type: "tool.started", sessionId: child, call: { ...call, id: "second" } }),
    { type: "turn.started", sessionId: parent, turn: 3 },
    { type: "message.started", sessionId: parent },
    { type: "message.delta", sessionId: parent, text: "Черновик текущего ответа" },
    wrap({ type: "tool.started", sessionId: child, call: { ...call, id: "overlapping" } }),
    { type: "message.reset", sessionId: parent, reason: "retry" },
    { type: "message.delta", sessionId: parent, text: "Нашёл расхождение." },
    {
      type: "message.finished",
      sessionId: parent,
      text: "Нашёл расхождение.",
      reasoning: "",
      toolCalls: [],
    },
  ];
  const live = new TaskView({ checkpointSaved() {} });
  for (const event of events) live.apply(event);
  const restored = new TaskView({ checkpointSaved() {} });
  restored.restore(
    events.filter((event) => event.type !== "message.delta" && event.type !== "message.reset"),
  );
  for (const view of [live, restored]) {
    const timeline = conversationItems(view.thread.items, workerMirrors(view.thread.items));
    expect(
      timeline
        .filter((item) => item.kind === "answer" || item.kind === "worker-tool")
        .map((item) =>
          item.kind === "answer" ? item.text : item.kind === "worker-tool" ? item.reference : "",
        ),
    ).toEqual([
      "Сначала проверю документацию.",
      call.id,
      "Теперь сверяю реализацию.",
      "second",
      "Нашёл расхождение.",
      "overlapping",
    ]);
    expect(timeline.filter((item) => item.kind === "answer").every((item) => !item.streaming)).toBe(
      true,
    );
  }
});
