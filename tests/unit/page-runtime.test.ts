import { expect, test } from "bun:test";
import type { PageCommand } from "../../src/core/pages/control";
import { PageRuntime } from "../../src/core/pages/runtime";
import type { Message, ToolCall } from "../../src/core/types";

test("logical pages require a begin and cannot continue until their completed history is compacted", async () => {
  const messages: Message[] = [{ role: "user", content: "Build authentication and a dashboard." }];
  const runtime = new PageRuntime(messages);
  expect(runtime.canFinish()).toBe(false);
  expect(runtime.guard([{ id: "premature", name: "done", args: {} }])).toContain("checkpoint");
  const work: ToolCall = { id: "work", name: "read", args: { path: "src/auth.ts" } };
  let index = 0;
  const call = async (args: PageCommand) => {
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
  expect(runtime.guard([work])).toContain("context begin");
  expect(
    (await call({ op: "complete", summary: "False claim", evidence: ["None"], next: "Stop" })).ok,
  ).toBe(false);
  const begin = {
    op: "begin" as const,
    title: "Authentication",
    objective: "Build Login and Registration.",
  };
  expect((await call(begin)).ok).toBe(true);
  expect(runtime.guard([work])).toBeUndefined();
  expect(runtime.canFinish()).toBe(false);
  expect((await call(begin)).ok).toBe(false);
  const complete = {
    op: "complete" as const,
    summary: "Authentication ready.",
    evidence: ["Auth checks passed."],
    next: "Build the dashboard shell.",
  };
  expect(runtime.guard([work, { id: "complete", name: "context", args: complete }])).toContain(
    "alone",
  );
  expect((await call(complete)).ok).toBe(true);
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
  expect(runtime.canFinish()).toBe(false);
  runtime.checkpointed();
  expect(runtime.canFinish()).toBe(true);
  expect(new PageRuntime(messages).canFinish()).toBe(false);
  expect(runtime.guard([work])).toContain("context begin");
  expect(
    (await call({ ...begin, title: "Dashboard", objective: "Build only the shell." })).ok,
  ).toBe(true);
  const activePage = runtime.active();
  if (!activePage) throw new Error("Expected an active dashboard page");
  messages.splice(0, messages.length, {
    role: "user",
    content: "Emergency compression; dashboard remains active.",
    contextSummary: {
      page: 2,
      fields: {
        changed: "shell",
        where: "src/shell.ts",
        rules: "preserve API",
        next: "verify",
        risks: "unfinished",
      },
      activePage,
    },
  });
  expect(new PageRuntime(messages).active()?.title).toBe("Dashboard");
  expect(new PageRuntime(messages).guard([work])).toBeUndefined();
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
