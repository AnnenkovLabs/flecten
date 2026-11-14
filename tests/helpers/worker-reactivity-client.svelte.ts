import { strict as assert } from "node:assert";
import { flushSync } from "svelte";
import { SessionStateSchema } from "../../shared/session-state";
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
