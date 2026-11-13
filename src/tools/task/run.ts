import type { SubagentInfo } from "../../../shared/subagents";
import type { SubagentRunner } from "../../core/subagents/runner";
import type { SubagentChildRunner, SubagentUsage } from "../../core/subagents/types";
import type { ToolResult } from "../../core/types";
import { abortable } from "../../util/abort";
import { defineTool, type ToolContext } from "../types";
import { type TaskArgs, taskSpec } from "./schema";

export interface SubagentInvocation {
  runner: SubagentRunner;
  runChild: SubagentChildRunner;
  signal?: AbortSignal;
}

export type SubagentRunnerFactory = (context: ToolContext) => SubagentInvocation;

export interface TaskToolContext extends ToolContext {
  subagentRunnerFactory?: SubagentRunnerFactory;
}

export interface SubagentTaskData {
  kind: "subagent";
  agent: string;
  data?: unknown;
  usage: SubagentUsage;
  error?: string;
}

export async function runTask(args: TaskArgs, context: ToolContext): Promise<ToolResult> {
  if (args.operation === "list")
    return { ok: true, output: JSON.stringify(context.subagents?.list() ?? []) };
  if (args.operation === "stop") {
    const stopped = args.id ? (context.subagents?.stop(args.id) ?? false) : false;
    return {
      ok: stopped,
      output: JSON.stringify({ id: args.id, stopped }),
      ...(stopped ? {} : { error: "No running subagent with this id." }),
    };
  }
  if (args.operation === "wait") {
    const task = args.id ? context.subagents?.get(args.id) : undefined;
    if (!task) return { ok: false, output: "", error: "Unknown subagent id. Use operation=list." };
    return waitForTask(task, context);
  }
  if (!args.agent || !args.prompt)
    return { ok: false, output: "", error: "agent and prompt are required for run." };
  const factory = (context as TaskToolContext).subagentRunnerFactory;
  if (factory === undefined) {
    return {
      ok: false,
      output: "",
      error:
        "The task tool is unavailable: no subagent runner factory is configured in ToolContext.",
    };
  }

  const invocation = factory(context);
  if (context.subagents) {
    const task = context.subagents.start(
      { agent: args.agent, prompt: args.prompt, context: args.context },
      invocation,
      context.sessionId,
      context.callId ?? `call_${crypto.randomUUID()}`,
    );
    return waitForTask(task, context);
  }
  const result = await invocation.runner.run(args.agent, args.prompt, {
    runChild: invocation.runChild,
    signal:
      invocation.signal === undefined
        ? context.signal
        : AbortSignal.any([context.signal, invocation.signal]),
    ...(args.context === undefined ? {} : { parentContext: args.context }),
  });

  return taskResult(args.agent, result);
}

async function waitForTask(
  task: {
    info: SubagentInfo;
    promise: Promise<import("../../core/subagents/types").SubagentRunResult>;
  },
  context: ToolContext,
): Promise<ToolResult> {
  const signal = context.waitSignal
    ? AbortSignal.any([context.signal, context.waitSignal])
    : context.signal;
  try {
    return taskResult(task.info.agent, await abortable(task.promise, signal), task.info.id);
  } catch (error) {
    if (!signal.aborted) throw error;
    return {
      ok: true,
      output: JSON.stringify({
        id: task.info.id,
        name: task.info.name,
        state: "running",
        message:
          "Parent stopped waiting. The subagent continues; use task wait or stop with this id.",
      }),
      data: { kind: "subagent", id: task.info.id, agent: task.info.agent, state: "running" },
    };
  }
}

function taskResult(
  agent: string,
  result: import("../../core/subagents/types").SubagentRunResult,
  id?: string,
): ToolResult {
  if (!result.ok) {
    const error = result.error ?? `Subagent "${agent}" failed.`;
    const data: SubagentTaskData = {
      kind: "subagent",
      agent,
      usage: result.usage,
      error,
    };
    return { ok: false, output: result.summary, error, data: { ...data, ...(id ? { id } : {}) } };
  }

  const data: SubagentTaskData = {
    kind: "subagent",
    agent,
    data: result.data,
    usage: result.usage,
  };
  return { ok: true, output: result.summary, data: { ...data, ...(id ? { id } : {}) } };
}

export const taskTool = defineTool({
  ...taskSpec,
  // The wait is cancellable; child lifetime and its ceiling belong to SubagentTasks.
  timeoutMs: () => 30 * 60_000,
  execute: runTask,
});
