import { expect, test } from "bun:test";
import { WorkerAcceptanceSchema } from "../../shared/worker-assignment";
import { type SessionEvent, TaskView } from "../../ui/src/lib/run/view.svelte";

const acceptance = WorkerAcceptanceSchema.parse({
  taskId: "research-task",
  assignment: {
    objective: "Compare the supplied sources",
    userConstraints: ["Keep the requested language"],
    expectedOutputs: ["A sourced comparison"],
    acceptanceCriteria: [
      { id: "sources", description: "Sources checked", evidenceRequirement: "tool_result" },
    ],
  },
  legacy: false,
  phase: "running",
  directions: [],
  criteria: [{ id: "sources", status: "open" }],
});
const update = (phase: typeof acceptance.phase): SessionEvent => ({
  type: "worker.acceptance",
  sessionId: "parent",
  acceptance: WorkerAcceptanceSchema.parse({
    ...acceptance,
    phase,
    criteria:
      phase === "accepted"
        ? [
            {
              id: "sources",
              status: "met",
              evidence: {
                kind: "tool_result",
                callId: "source-read",
                tool: "read",
                output: "source contents",
                statement: "Sources checked",
              },
            },
          ]
        : acceptance.criteria,
  }),
});
const started: SessionEvent = {
  type: "worker.event",
  sessionId: "parent",
  event: {
    type: "session.started",
    sessionId: "parent_worker",
    provider: "test",
    model: "test",
  },
};
const finished: SessionEvent = {
  type: "worker.event",
  sessionId: "parent",
  event: {
    type: "session.finished",
    sessionId: "parent_worker",
    result: {
      sessionId: "parent_worker",
      summary: "Comparison prepared",
      pass: true,
      stopReason: "done",
      turns: 1,
      usage: { input: 0, output: 0, cached: 0 },
    },
  },
};

test("Worker acceptance survives replay and keeps a finished run busy until review settles", () => {
  const events = [update("running"), started, finished, update("reviewing")];
  for (const replay of [false, true]) {
    const view = new TaskView({ checkpointSaved() {} });
    if (replay) view.restore(events);
    else for (const event of events) view.apply(event);
    expect(view.worker.items[0]?.acceptance?.assignment.objective).toBe(
      acceptance.assignment.objective,
    );
    expect(view.worker.running).toBe(true);
    view.apply(update("unconfirmed"));
    expect(view.worker.running).toBe(false);
    expect(view.worker.resumable).toBe(true);
    expect(view.worker.items[0]?.acceptance?.phase).toBe("unconfirmed");
    view.apply(update("accepted"));
    expect(view.worker.items[0]?.acceptance?.phase).toBe("accepted");
    expect(view.worker.resumable).toBe(false);
  }
});

test("disconnect makes in-flight acceptance unconfirmed without losing its criteria", () => {
  const view = new TaskView({ checkpointSaved() {} });
  view.restore([update("running"), started, finished, update("reviewing")]);
  view.worker.disconnected();
  expect(view.worker.running).toBe(false);
  expect(view.worker.items[0]?.acceptance).toMatchObject({
    phase: "unconfirmed",
    criteria: [{ id: "sources", status: "open" }],
  });
});
