import { expect, test } from "bun:test";
import { toolAction } from "../../ui/src/lib/agent";
import { setLocale } from "../../ui/src/lib/i18n.svelte";
import { TaskView } from "../../ui/src/lib/run/view.svelte";
import { subagentReport } from "../../ui/src/lib/subagent-report";
import { toolName, toolState } from "../../ui/src/lib/tool-presentation";
import type { AgentEvent, AgentToolCall } from "../../ui/src/lib/types";

test("a subagent keeps its task, lifecycle and readable report through live events and replay", () => {
  const view = new TaskView({ checkpointSaved() {} });
  const call: AgentToolCall = {
    id: "research",
    name: "task",
    args: {
      agent: "explore",
      prompt: "Trace task events\nKeep this exact.",
      context: "Workspace context",
    },
  };
  const events: AgentEvent[] = [
    {
      type: "session.started",
      sessionId: "s",
      provider: "test",
      model: "test",
      prompt: "Investigate",
    },
    { type: "turn.started", sessionId: "s", turn: 1 },
    { type: "message.finished", sessionId: "s", text: "", reasoning: "", toolCalls: [call] },
    { type: "tool.started", sessionId: "s", call },
  ];
  view.restore(events);
  const run = view.thread.items.find((item) => item.kind === "run");
  if (run?.kind !== "run") throw new Error("No run");
  expect(run.summary.list).toHaveLength(1);
  const action = run.summary.list[0];
  if (!action) throw new Error("No subagent action");
  expect(action.label).toBe("Субагент: Исследователь");
  expect(action.subject).toBe("Trace task events\nKeep this exact.");
  expect(toolState(action)).toBe("Running");
  const data = {
    kind: "subagent",
    agent: "explore",
    data: {
      summary: "Found the cause",
      files: ["ui/src/lib/agent.ts"],
      findings: ["Fallback hides details"],
      openQuestions: [],
    },
  };
  const finished: AgentEvent = {
    type: "tool.finished",
    sessionId: "s",
    call,
    result: { ok: true, output: JSON.stringify(data.data), data, durationMs: 1200 },
  };
  view.restore([finished]);
  const complete = run.summary.list[0];
  if (!complete) throw new Error("No result");
  expect(toolState(complete)).toBe("Finished");
  expect(subagentReport(complete.detail?.resultData)?.summary).toBe("Found the cause");
  expect(subagentReport(complete.detail?.resultData)?.sections).toEqual([
    { label: "Findings", items: ["Fallback hides details"] },
    { label: "Files", items: ["ui/src/lib/agent.ts"] },
  ]);
  const restored = new TaskView({ checkpointSaved() {} });
  restored.restore([...events, finished]);
  const replay = restored.thread.items.find((item) => item.kind === "run");
  expect(replay?.kind === "run" && replay.summary.list[0]?.detail).toEqual(complete.detail);
  setLocale("en");
  expect(complete.label).toBe("Subagent: Researcher");
});

test("stopping a run leaves unfinished calls interrupted, never finished", () => {
  const view = new TaskView({ checkpointSaved() {} });
  view.thread.beginRun("Inspect");
  view.thread.startTool({
    id: "task",
    name: "task",
    args: { agent: "review", prompt: "Review changes" },
  });
  view.thread.finishRun({
    sessionId: "s",
    pass: false,
    stopReason: "stopped",
    summary: "",
    turns: 1,
    usage: { input: 0, output: 0, cached: 0 },
  });
  const run = view.thread.items.find((item) => item.kind === "run");
  const action = run?.kind === "run" ? run.summary.list[0] : undefined;
  expect(action && toolState(action)).toBe("Interrupted");
  view.thread.beginRun("Inspect again");
  view.thread.startTool({
    id: "disconnected",
    name: "task",
    args: { agent: "explore", prompt: "Investigate" },
  });
  view.coreLost();
  const disconnected = view.thread.items.at(-1);
  const interrupted = disconnected?.kind === "run" ? disconnected.summary.list[0] : undefined;
  expect(interrupted && toolState(interrupted)).toBe("Interrupted");
});

test("every built-in and operation has an explicit name, and unknown tools retain their details", () => {
  setLocale("en");
  for (const name of [
    "read",
    "write",
    "edit",
    "apply_patch",
    "delete",
    "move",
    "todo",
    "task",
    "grep",
    "glob",
    "ask",
    "web_fetch",
    "web_search",
    "lsp",
    "terminal",
    "bash",
    "jobs",
    "skill",
    "done",
  ]) {
    expect(toolName(name)).not.toBe(name);
  }
  expect(toolName("terminal", { op: "write" })).toBe("Send terminal input");
  expect(toolName("jobs", { op: "wait" })).toBe("Wait for job");
  expect(toolName("git", { operation: "diff" })).toBe("Review changes");
  expect(toolName("task", { agent: "custom reviewer" })).toBe("Subagent: custom reviewer");
  expect(toolName("task", { agent: "constructor" })).toBe("Subagent: constructor");
  expect(toolName("constructor")).toBe("Tool: constructor");
  expect(toolName("memory", { operation: "save" })).toBe("Save memory");
  const cancelled = toolAction(
    { id: "cancelled", name: "task", args: { agent: "review", prompt: "Review" } },
    { ok: false, output: "", data: { cancelled: true }, error: "Stopped by user" },
  );
  expect(toolState(cancelled)).toBe("Stopped");
  const unknown = toolAction(
    { id: "external", name: "mcp_custom_lookup", args: { term: "query" } },
    {
      ok: false,
      output: "partial output",
      error: "Reconnect the service",
      fullOutputPath: "logs/external.txt",
    },
  );
  expect(unknown.label).toBe("Tool: mcp_custom_lookup");
  expect(unknown.detail).toMatchObject({
    input: { term: "query" },
    output: "partial output",
    error: "Reconnect the service",
    fullOutputPath: "logs/external.txt",
  });
  expect(toolState(unknown)).toBe("Failed");
  expect(subagentReport({ kind: "subagent", data: { summary: 42 } })).toBeUndefined();
  expect(
    subagentReport({
      kind: "subagent",
      data: {
        verdict: "fail",
        findings: [{ severity: "high", message: "Broken", file: "a.ts", line: 4 }],
      },
    })?.sections[0]?.items,
  ).toEqual(["High severity: a.ts:4: Broken"]);
});
