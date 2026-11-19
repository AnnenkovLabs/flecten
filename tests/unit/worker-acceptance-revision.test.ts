import { expect, test } from "bun:test";
import { ConversationAcceptance } from "../../src/app/conversation-acceptance";
import type { Event } from "../../src/core/types";

const assignment = {
  objective: "Compare source versions",
  userConstraints: [],
  expectedOutputs: ["A comparison"],
  acceptanceCriteria: [
    {
      id: "source",
      description: "Read the current version",
      evidenceRequirement: "tool_result" as const,
    },
  ],
};
const report = {
  criterionId: "source",
  status: "met" as const,
  evidence: { kind: "tool_result" as const, callId: "read-source", statement: "Source inspected" },
};

test("steering and replay reject evidence gathered before the latest direction", () => {
  const events: Event[] = [];
  const ledger = new ConversationAcceptance((acceptance) =>
    events.push({
      type: "worker.acceptance",
      sessionId: "parent",
      acceptance: structuredClone(acceptance),
    }),
  );
  ledger.begin(undefined, assignment);
  const observed = {
    type: "tool.finished" as const,
    sessionId: "parent_worker",
    call: { id: "read-source", name: "read", args: { path: "source.txt" } },
    result: { ok: true, output: "Version one" },
  };
  ledger.note(observed);
  events.push({ type: "worker.event", sessionId: "parent", event: observed });
  ledger.report(report);
  ledger.reopen("Use the updated source.");
  expect(() => ledger.report(report)).toThrow("successful tool result");
  const restored = new ConversationAcceptance(() => {});
  restored.restore(events);
  restored.resume();
  expect(() => restored.report(report)).toThrow("successful tool result");
  restored.note({ ...observed, result: { ok: true, output: "Version two" } });
  expect(restored.report(report).criteria[0]?.evidence?.output).toBe("Version two");
});

test("supports batch criterion reports, shown call IDs, and prior tool evidence after post-steer verification", () => {
  const ledger = new ConversationAcceptance(() => {});
  ledger.begin(undefined, {
    objective: "Implement and test feature",
    userConstraints: [],
    expectedOutputs: ["Feature implemented and tested"],
    acceptanceCriteria: [
      { id: "impl", description: "Edit source", evidenceRequirement: "tool_result" },
      { id: "test", description: "Run tests", evidenceRequirement: "tool_result" },
    ],
  });
  const editEvent = {
    type: "tool.finished" as const,
    sessionId: "parent_worker",
    call: { id: "call_edit_1", name: "edit", args: { path: "a.ts" } },
    result: { ok: true, output: "Edited a.ts" },
  };
  ledger.note(editEvent, {
    ...editEvent,
    call: { ...editEvent.call, id: "w_shown_edit_1" },
  });
  ledger.reopen("Also verify tests pass.");
  const testEvent = {
    type: "tool.finished" as const,
    sessionId: "parent_worker",
    call: { id: "call_bash_2", name: "bash", args: { command: "bun test" } },
    result: { ok: true, output: "10 pass" },
  };
  ledger.note(testEvent, {
    ...testEvent,
    call: { ...testEvent.call, id: "w_shown_bash_2" },
  });
  const state = ledger.report([
    {
      criterionId: "impl",
      status: "met",
      evidence: { kind: "tool_result", callId: "call_edit_1", statement: "Edited a.ts" },
    },
    {
      criterionId: "test",
      status: "met",
      evidence: { kind: "tool_result", callId: "w_shown_bash_2", statement: "Tests passed" },
    },
  ]);
  expect(state.criteria.every((c) => c.status === "met")).toBe(true);
  expect(state.criteria[0]?.evidence?.callId).toBe("w_shown_edit_1");
  expect(state.criteria[1]?.evidence?.callId).toBe("w_shown_bash_2");
});
