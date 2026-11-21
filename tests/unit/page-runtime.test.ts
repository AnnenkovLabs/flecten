import { expect, test } from "bun:test";
import type { PageCommand } from "../../src/core/pages/control";
import { PageRuntime } from "../../src/core/pages/runtime";
import type { Message, ToolCall } from "../../src/core/types";

test("logical pages compact directly at logical-block boundaries without requiring context begin", async () => {
  const messages: Message[] = [{ role: "user", content: "Build authentication and a dashboard." }];
  const runtime = new PageRuntime(messages);
  expect(runtime.canFinish()).toBe(true);
  const work: ToolCall = { id: "work", name: "read", args: { path: "src/auth.ts" } };
  let index = 0;
  const call = async (args: PageCommand | Record<string, unknown>) => {
    const toolCall: ToolCall = { id: `context-${index++}`, name: "context", args };
    const result = await runtime.execute(args);
    messages.push(
      { role: "assistant", content: "", reasoning: "", toolCalls: [toolCall] },
      {
        role: "tool",
        name: "context",
        toolCallId: toolCall.id,
        content: result.output,
        ...(result.ok ? {} : { isError: true }),
      },
    );
    return result;
  };
  expect(runtime.guard([work])).toBeUndefined();
  const compact = {
    op: "compact" as const,
    summary: "Authentication ready.",
    evidence: ["Auth checks passed."],
    next: "Build the dashboard shell.",
  };
  expect(runtime.guard([work, { id: "compact", name: "context", args: compact }])).toContain(
    "alone",
  );
  expect(
    runtime.guard([
      { id: "crit", name: "criterion", args: { operation: "list" } },
      { id: "compact", name: "context", args: compact },
    ]),
  ).toBeUndefined();
  expect((await call(compact)).ok).toBe(true);
  const restored = new PageRuntime(structuredClone(messages));
  expect(restored.pending()).toBe(true);
  expect(restored.guard([work])).toContain("must be compacted");
  expect(restored.canFinish()).toBe(false);
  messages.splice(0, messages.length, {
    role: "user",
    content: "Authentication finished; build dashboard next.",
    contextSummary: {
      page: 1,
      fields: {
        changed: "auth",
        where: "src/auth.ts",
        rules: "preserve API",
        next: "dashboard",
        risks: "none",
      },
    },
  });
  expect(runtime.pending()).toBe(false);
  runtime.checkpointed();
  expect(runtime.canFinish()).toBe(true);
  expect(runtime.guard([work])).toBeUndefined();
  const implicitCompact = await call({
    summary: "Dashboard shell ready.",
    evidence: ["Shell checks passed."],
    next: "Done.",
  });
  expect(implicitCompact.ok).toBe(true);
});

test("an explicit blocker survives restart as a pending checkpoint without completing its objective", async () => {
  const activePage = { title: "Authentication", objective: "Connect the real identity provider." };
  const messages: Message[] = [
    {
      role: "user",
      content: "Continue authentication.",
      contextSummary: {
        page: 1,
        activePage,
        fields: {
          changed: "UI",
          where: "auth.ts",
          rules: "real provider",
          next: "connect",
          risks: "credentials missing",
        },
      },
    },
  ];
  const runtime = new PageRuntime(messages);
  const report = {
    summary: "Provider access is missing.",
    evidence: ["The required account has no credentials."],
    next: "Ask the user for provider access.",
  };
  const call: ToolCall = { id: "blocked", name: "context", args: { op: "block", ...report } };
  expect(runtime.guard([call, { id: "work", name: "read", args: {} }])).toContain("alone");
  const result = await runtime.execute(call.args);
  expect(result.ok).toBe(true);
  messages.push(
    { role: "assistant", content: "", reasoning: "", toolCalls: [call] },
    { role: "tool", name: "context", toolCallId: call.id, content: result.output },
  );
  const restored = new PageRuntime(structuredClone(messages));
  expect(restored.blocked()).toEqual(report);
  expect(restored.active()).toEqual(activePage);
  expect(restored.pending()).toBe(true);
  expect(restored.guard([{ id: "next", name: "read", args: {} }])).toContain("must be compacted");
  restored.checkpointed();
  expect(restored.canFinish()).toBe(false);
});
