import { strict as assert } from "node:assert";
import { flushSync } from "svelte";
import { SessionStateSchema } from "../../shared/session-state";
import { WorkerAcceptanceSchema } from "../../shared/worker-assignment";
import type { AgentEvent } from "../../ui/src/lib/agent-protocol";
import { t } from "../../ui/src/lib/i18n.svelte";
import { TaskView } from "../../ui/src/lib/run/view.svelte";

export function verifyWorkerReactivity(): void {
  const view = new TaskView({ checkpointSaved() {} });
  const idle = SessionStateSchema.parse({
    sessionId: "parent",
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
  view.applyState(idle);
  let rendered = { busy: false, stopping: false };
  const dispose = $effect.root(() => {
    $effect(() => {
      rendered = { busy: view.busy, stopping: view.stopping };
    });
  });
  flushSync();
  const start = () =>
    view.apply({
      type: "worker.event",
      sessionId: "parent",
      event: {
        type: "session.started",
        sessionId: "child",
        provider: "test",
        model: "test",
        prompt: "Verify project",
      },
    });
  try {
    for (let run = 0; run < 2; run++) {
      start();
      flushSync();
      assert.deepEqual(rendered, { busy: true, stopping: false });
      view.apply({
        type: "worker.event",
        sessionId: "parent",
        event: {
          type: "session.state",
          sessionId: "child",
          state: {
            ...idle,
            sessionId: "child",
            epoch: "worker",
            phase: "running",
            running: true,
            stopRequested: true,
          },
        },
      });
      flushSync();
      assert.deepEqual(rendered, { busy: true, stopping: true });
      view.apply({
        type: "worker.event",
        sessionId: "parent",
        event: { type: "run.interrupted", sessionId: "child", at: 1, reason: "stopped" },
      });
      flushSync();
      assert.deepEqual(rendered, { busy: false, stopping: false });
    }
    start();
    flushSync();
    assert.equal(rendered.busy, true);
    view.reset();
    flushSync();
    assert.deepEqual(rendered, { busy: false, stopping: false });
  } finally {
    dispose();
  }
}

export function verifyWorkerTranscript(): void {
  const view = new TaskView({ checkpointSaved() {} });
  const worker = view.worker;
  const events: AgentEvent[] = [];
  const apply = (
    event: Extract<AgentEvent, { type: "worker.event" }>["event"],
    timestamp = 1000,
    reasoningStartedAt?: number,
  ) => {
    const envelope = {
      type: "worker.event" as const,
      sessionId: "parent",
      event,
      timestamp,
      ...(reasoningStartedAt !== undefined ? { reasoningStartedAt } : {}),
    };
    events.push(envelope);
    view.apply(envelope);
    flushSync();
  };
  const call = { id: "read-project", name: "read", args: { path: "README.md" } };
  const getRun = () => worker.transcript.items.find((entry) => entry.kind === "run");
  let rendered = "";
  let renderedOutput = "";
  const dispose = $effect.root(() => {
    $effect(() => {
      rendered = `${worker.liveLabel}:${worker.transcript.pendingCalls.length}:${worker.transcript.items
        .filter((entry) => entry.kind === "answer")
        .map((entry) => entry.text)
        .join("|")}`;
      renderedOutput = worker.items
        .flatMap((entry) => entry.actions.map((action) => action.detail?.output ?? ""))
        .join("|");
    });
  });
  try {
    apply({
      type: "session.started",
      sessionId: "child",
      provider: "test",
      model: "test",
      prompt: "Verify project",
    });
    assert.equal(worker.liveLabel, t("Thinking"));
    assert.equal(worker.transcript.items[0]?.kind, "message");
    apply({ type: "turn.started", sessionId: "child", turn: 1 });
    apply({ type: "reasoning.delta", sessionId: "child", text: "Inspect the current API." });
    assert.equal(getRun()?.summary.turns[0]?.reasoningStreaming, true);
    apply({ type: "message.started", sessionId: "child" });
    apply({ type: "message.delta", sessionId: "child", text: "Discard this draft" });
    assert.ok(rendered.includes(`${t("Writing")}:0:Discard this draft`));
    apply({ type: "message.reset", sessionId: "child", reason: "retry" });
    apply({ type: "message.delta", sessionId: "child", text: "Reading project documentation." });
    apply({
      type: "tool_call.progress",
      sessionId: "child",
      index: 0,
      name: "read",
      delta: '{"path":"README.md"}',
    });
    assert.ok(rendered.startsWith(`${t("Preparing a call")}:1:`));
    apply(
      {
        type: "message.finished",
        sessionId: "child",
        text: "Reading project documentation.",
        reasoning: "Inspect the current API.",
        toolCalls: [call],
      },
      2000,
      1000,
    );
    assert.equal(getRun()?.summary.turns[0]?.reasoningStreaming, false);
    assert.equal(worker.transcript.pendingCalls.length, 0);
    apply({ type: "tool.started", sessionId: "child", call });
    assert.equal(worker.liveLabel, t("Working"));
    apply({ type: "tool.output", sessionId: "child", callId: call.id, text: "Project API\n" });
    assert.equal(worker.items[0]?.actions[0]?.detail?.output, "Project API\n");
    assert.equal(getRun()?.summary.list[0]?.detail?.output, "Project API\n");
    assert.equal(renderedOutput, "Project API\n");
    const approval = {
      id: "approval",
      action: "read",
      tool: "read",
      target: "README.md",
      reason: "Review access",
      createdAt: 1,
      expiresAt: 10000,
    };
    apply({ type: "approval.requested", sessionId: "child", approval });
    assert.equal(worker.liveLabel, t("Awaiting approval"));
    assert.equal(
      worker.transcript.items.find((entry) => entry.kind === "approval")?.state,
      "pending",
    );
    assert.equal(view.thread.items.find((entry) => entry.kind === "approval")?.state, "pending");
    apply({
      type: "session.state",
      sessionId: "child",
      state: SessionStateSchema.parse({
        sessionId: "child",
        epoch: "worker",
        revision: 2,
        phase: "running",
        running: true,
        interrupted: false,
        turns: 1,
        queue: [],
        approvals: [],
        jobs: [],
        approvalResolutions: [{ id: approval.id, choice: "allow_once", by: "user" }],
      }),
    });
    assert.equal(worker.liveLabel, t("Working"));
    assert.equal(
      worker.transcript.items.find((entry) => entry.kind === "approval")?.state,
      "allow_once",
    );
    assert.equal(view.thread.items.find((entry) => entry.kind === "approval")?.state, "allow_once");
    apply({
      type: "approval.resolved",
      sessionId: "child",
      id: approval.id,
      choice: "allow_once",
      by: "user",
    });
    apply({
      type: "tool.finished",
      sessionId: "child",
      call,
      result: { ok: true, output: "Project API\n", durationMs: 10 },
    });
    assert.equal(worker.items[0]?.actions[0], getRun()?.summary.list[0]);
    apply({
      type: "provider.retry",
      sessionId: "child",
      kind: "network",
      attempt: 1,
      delayMs: 1000,
      until: 4000,
      reason: "Provider disconnected",
    });
    assert.equal(worker.retryUntil, 4000);
    assert.equal(worker.liveLabel, t("No connection to provider"));
    apply({ type: "turn.started", sessionId: "child", turn: 2 }, 4000);
    assert.equal(worker.retryUntil, 0);
    assert.equal(worker.liveLabel, t("Thinking"));
    apply(
      { type: "reasoning.delta", sessionId: "child", text: "The documented API is intact." },
      4500,
    );
    const done = {
      id: "done",
      name: "done",
      args: { summary: "Project verified", evidence: ["Documentation inspected"] },
    };
    apply(
      {
        type: "message.finished",
        sessionId: "child",
        text: "",
        reasoning: "The documented API is intact.",
        toolCalls: [done],
      },
      5000,
      4500,
    );
    apply({
      type: "tool.finished",
      sessionId: "child",
      call: done,
      result: {
        ok: true,
        output: "Project verified",
        data: { kind: "done", summary: "Project verified", evidence: ["Documentation inspected"] },
      },
    });
    apply(
      {
        type: "session.finished",
        sessionId: "child",
        result: {
          sessionId: "child",
          pass: true,
          stopReason: "done",
          summary: "Project verified",
          turns: 2,
          usage: { input: 0, output: 0, cached: 0 },
        },
      },
      6000,
    );
    assert.equal(worker.running, false);
    assert.equal(worker.liveLabel, t("Done"));
    assert.equal(getRun()?.summary.text, "Project verified");
    assert.equal(getRun()?.summary.live, false);
    const replay = new TaskView({ checkpointSaved() {} });
    replay.restore(
      events.filter(
        (event) =>
          event.type === "worker.event" &&
          event.event.type !== "message.delta" &&
          event.event.type !== "message.reset" &&
          event.event.type !== "reasoning.delta",
      ),
    );
    const replayRun = replay.worker.transcript.items.find((entry) => entry.kind === "run");
    assert.equal(replayRun?.summary.text, "Project verified");
    assert.equal(replayRun?.summary.turns[0]?.reasoningMs, 1000);
    assert.equal(replayRun?.summary.turns[1]?.reasoningMs, 500);
    assert.equal(replay.worker.items[0]?.actions.length, 2);
    const acceptance = WorkerAcceptanceSchema.parse({
      taskId: "task",
      assignment: {
        objective: "Verify project",
        userConstraints: [],
        expectedOutputs: ["A verified project"],
        acceptanceCriteria: [
          { id: "verified", description: "API preserved", evidenceRequirement: "model_assertion" },
        ],
      },
      legacy: true,
      phase: "running",
      directions: [],
      criteria: [{ id: "verified", status: "open" }],
    });
    const reviewed = new TaskView({ checkpointSaved() {} });
    reviewed.worker.acceptance(acceptance);
    const firstEvent = events[0];
    if (!firstEvent || firstEvent.type !== "worker.event") throw new Error("Missing Worker start");
    reviewed.apply(firstEvent);
    const finishEvent = events.at(-1);
    if (!finishEvent || finishEvent.type !== "worker.event")
      throw new Error("Missing Worker finish");
    reviewed.apply(finishEvent);
    assert.equal(reviewed.worker.liveLabel, t("Completion unconfirmed"));
    reviewed.worker.acceptance({ ...acceptance, phase: "reviewing" });
    assert.equal(reviewed.worker.liveLabel, t("Reviewing result"));
    assert.equal(reviewed.worker.running, true);
    reviewed.worker.acceptance({
      ...acceptance,
      phase: "accepted",
      criteria: [
        {
          id: "verified",
          status: "met",
          evidence: { kind: "model_assertion", statement: "API preserved" },
        },
      ],
    });
    assert.equal(reviewed.worker.liveLabel, t("Done"));
    assert.equal(reviewed.worker.running, false);
    reviewed.worker.acceptance({ ...acceptance, phase: "unconfirmed" });
    assert.equal(reviewed.worker.liveLabel, t("Completion unconfirmed"));
    assert.equal(reviewed.worker.resumable, true);
    apply({
      type: "session.started",
      sessionId: "child",
      provider: "test",
      model: "test",
      prompt: "Check again",
    });
    apply({ type: "turn.started", sessionId: "child", turn: 1 });
    apply({ type: "reasoning.delta", sessionId: "child", text: "Check for changes." });
    apply({ type: "tool.started", sessionId: "child", call: { ...call, id: "interrupted" } });
    apply({ type: "run.interrupted", sessionId: "child", at: 7000, reason: "stopped" });
    const lastRun = worker.transcript.items.filter((entry) => entry.kind === "run").at(-1);
    assert.equal(worker.running, false);
    assert.equal(lastRun?.summary.live, false);
    assert.equal(lastRun?.summary.turns[0]?.reasoningStreaming, false);
    assert.equal(lastRun?.summary.list[0]?.state, "interrupted");
    assert.equal(worker.items.at(-1)?.actions[0]?.running, false);
    apply({ type: "session.started", sessionId: "child", provider: "test", model: "test" });
    apply({ type: "reasoning.delta", sessionId: "child", text: "Resume the inspection." });
    view.coreLost();
    flushSync();
    assert.equal(worker.running, false);
    assert.equal(worker.liveLabel, t("Interrupted"));
    assert.equal(
      worker.transcript.items.filter((entry) => entry.kind === "run").at(-1)?.summary.turns[0]
        ?.reasoningStreaming,
      false,
    );
    apply({ type: "session.started", sessionId: "child", provider: "test", model: "test" });
    apply({ type: "reasoning.delta", sessionId: "child", text: "Keep checking." });
    view.coreLost();
    assert.equal(worker.running, false);
    assert.equal(worker.liveLabel, t("Interrupted"));
    assert.equal(
      worker.transcript.items.filter((entry) => entry.kind === "run").at(-1)?.summary.turns[0]
        ?.reasoningStreaming,
      false,
    );
    view.reset();
    flushSync();
    assert.equal(worker.transcript.items.length, 0);
    assert.equal(worker.retryUntil, 0);
  } finally {
    dispose();
  }
}
