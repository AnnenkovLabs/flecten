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
