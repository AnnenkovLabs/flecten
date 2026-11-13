import { permissionRequestKey } from "../../security/permission-request-key";
import type { PermissionRequest } from "../../security/types";
import { ToolRegistry } from "../../tools/registry";
import type { ToolContext } from "../../tools/types";
import { isObject } from "../../util/json";
import { markdownData } from "../../util/markdown";
import { Mutex } from "../../util/mutex";
import type { HookOutcome } from "../hooks/types";
import type { ToolCall, ToolResult } from "../types";
import type { CallScope } from "./calls";
import { permissionRequest } from "./permission-request";
import { type PermissionReview, withPermissionReview } from "./permission-review";
import { authorizeCall, denied, recheckPermission } from "./tool-authorization";
import type { LoopEvent, LoopOptions } from "./types";

export type ToolExecutionOptions = Pick<
  LoopOptions,
  "tools" | "toolContext" | "signal" | "stopSignal" | "hooks" | "calls" | "parallelTools" | "goal"
> &
  Partial<Pick<LoopOptions, "provider" | "userSource">> & {
    permissionReviewTimeoutMs?: number;
  };

function cancelled(result: ToolResult): ToolResult {
  return {
    ...result,
    ok: false,
    error:
      "Пользователь отменил этот вызов из карточки, процесс остановлен. Не повторяйте его без новой причины.",
    data: { ...(isObject(result.data) ? result.data : {}), errorKind: "aborted", cancelled: true },
  };
}

function withHookContext(result: ToolResult, outcome: HookOutcome): ToolResult {
  if (outcome.context.length === 0) return result;
  const context = outcome.context
    .map((text) => markdownData("Hook context", [["Source", "configured hook"]], text))
    .join("\n\n");
  return { ...result, output: result.output ? `${result.output}\n\n${context}` : context };
}

function emitHooks(outcome: HookOutcome | undefined, emit: (event: LoopEvent) => void): void {
  for (const hook of outcome?.runs ?? []) emit({ type: "hook.finished", hook });
}

interface PreparedCall {
  call: ToolCall;
  hookInput: {
    sessionId: string;
    cwd: string;
    toolName: string;
    toolArgs: unknown;
  };
  pre?: HookOutcome;
  request?: PermissionRequest;
  context: ToolContext;
  denied?: ToolResult;
  revision?: string;
  feedback?: string;
  review?: PermissionReview;
  intent?: string;
}

export async function executeCalls(
  calls: ToolCall[],
  options: ToolExecutionOptions,
  emit: (event: LoopEvent) => void,
  results: ToolResult[],
): Promise<void> {
  const pageGuard = options.toolContext.contextPages?.guard(
    calls.map((call) => ({ ...call, name: options.tools.canonicalName(call.name) })),
  );
  if (pageGuard) {
    for (const call of calls) {
      const result: ToolResult = { ok: false, output: "", error: pageGuard };
      emit({ type: "tool.started", call });
      emit({ type: "tool.finished", call, result });
      results.push(result);
    }
    return;
  }
  const mutex = new Mutex();
  const stopped = (): ToolResult => ({
    ok: false,
    output: "",
    error: "Run stopped by the user before this call started.",
  });
  const context: ToolContext = {
    ...options.toolContext,
    ...options.toolContext.security?.(),
    permissionIntent: options.toolContext.permissionIntent ?? (() => options.userSource),
    signal: options.signal,
  };
  const inputs = calls.map((call) => options.tools.prepare(call));
  calls = calls.map((call, index) => inputs[index]?.call ?? call);
  const display = calls.map((call) => ({ ...call, name: options.tools.canonicalName(call.name) }));

  const batch = options.stopSignal?.aborted
    ? undefined
    : await options.hooks?.run(
        "toolBatch",
        {
          sessionId: context.sessionId,
          cwd: context.cwd,
          toolBatch: {
            tools: display
              .filter((_, index) => !inputs[index]?.error)
              .map((call) => ({ name: call.name, args: call.args })),
            parallel: options.parallelTools && calls.length > 1,
          },
        },
        options.signal,
      );
  emitHooks(batch, emit);
  if (batch?.blocked || options.stopSignal?.aborted) {
    for (const call of display) {
      const result = options.stopSignal?.aborted
        ? stopped()
        : denied(batch?.reason ?? "Tool batch denied by hook");
      results.push(result);
      emit({ type: "tool.started", call });
      emit({ type: "tool.finished", call, result });
    }
    return;
  }

  const prepare = async (call: ToolCall, callContext: ToolContext): Promise<PreparedCall> => {
    const normalized = options.tools.prepare(call);
    if (normalized.call) call = normalized.call;
    const hookInput = {
      sessionId: context.sessionId,
      cwd: context.cwd,
      toolName: call.name,
      toolArgs: call.args,
    };
    if (options.stopSignal?.aborted || callContext.signal.aborted)
      return { call, hookInput, context: callContext, denied: stopped() };
    if (normalized.error)
      return { call, hookInput, context: callContext, denied: normalized.error };
    const pre = await options.hooks?.run("preToolUse", hookInput, callContext.signal);
    emitHooks(pre, emit);
    if (pre?.blocked) {
      const blocked: ToolResult = {
        ok: false,
        output: "",
        error: `Blocked by hook: ${pre.reason ?? "preToolUse denied the call"}`,
        data: { kind: "hook", event: "preToolUse" },
      };
      return { call, hookInput, context: callContext, pre, denied: withHookContext(blocked, pre) };
    }
    const intent = callContext.permissionIntent?.();
    const permission = await authorizeCall(call, options, callContext, emit);
    if (permission.error) {
      return {
        call,
        hookInput,
        context: callContext,
        ...(permission.request ? { request: permission.request } : {}),
        ...(permission.review ? { review: permission.review } : {}),
        ...(pre ? { pre } : {}),
        denied: pre ? withHookContext(permission.error, pre) : permission.error,
      };
    }
    return {
      call,
      hookInput,
      context: callContext,
      ...(permission.request ? { request: permission.request } : {}),
      ...(permission.review ? { review: permission.review } : {}),
      ...(intent === undefined ? {} : { intent }),
      ...(callContext.permissions ? { revision: callContext.permissions.revision } : {}),
      ...(permission.feedback !== undefined ? { feedback: permission.feedback } : {}),
      ...(pre ? { pre } : {}),
    };
  };

  const run = async (call: ToolCall, current: ToolContext): Promise<ToolResult> => {
    const callContext = {
      ...current,
      invokeTool: async (
        tool: import("../../tools/types").Tool,
        args: unknown,
        nestedContext: ToolContext = current,
      ): Promise<ToolResult> => {
        const nested: ToolResult[] = [];
        await executeCalls(
          [{ id: `${call.id}-${crypto.randomUUID()}`, name: tool.name, args }],
          {
            ...options,
            tools: new ToolRegistry([tool], { limits: context.limits }),
            toolContext: nestedContext,
            signal: nestedContext.signal,
            parallelTools: false,
          },
          (event) => {
            if (event.type === "hook.finished") emit(event);
            if (event.type === "tool.output") emit({ ...event, callId: call.id });
          },
          nested,
        );
        return nested[0] ?? { ok: false, output: "", error: "Nested tool did not run" };
      },
      reportOutput: (text: string) => emit({ type: "tool.output", callId: call.id, text }),
    };
    return options.tools.run(call, callContext);
  };

  const execute = async (prepared: PreparedCall): Promise<ToolResult> => {
    if (options.stopSignal?.aborted || prepared.context.signal.aborted) return stopped();
    if (prepared.denied) return prepared.denied;
    if (options.tools.canonicalName(prepared.call.name) === "done") {
      if (calls.length > 1) {
        return {
          ok: false,
          output: "",
          error: "Call done alone, after all other tool results have been inspected.",
        };
      }
      const remaining = options.goal?.remainingCriteria() ?? [];
      if (remaining.length > 0) {
        return {
          ok: false,
          output: "",
          error: `Cannot finish while work remains:\n${remaining.map((criterion) => `- ${criterion}`).join("\n")}`,
        };
      }
    }
    const isSubagent = options.tools.canonicalName(prepared.call.name) === "task";
    const args = isObject(prepared.call.args) ? prepared.call.args : {};
    const agent = typeof args.agent === "string" ? args.agent : "unknown";
    if (isSubagent) {
      const before = await options.hooks?.run(
        "subagent",
        {
          ...prepared.hookInput,
          subagent: {
            agent,
            phase: "start",
            ...(typeof args.prompt === "string" ? { task: args.prompt } : {}),
          },
        },
        prepared.context.signal,
      );
      emitHooks(before, emit);
      if (before?.blocked) return denied(before.reason ?? "Subagent denied by hook");
    }
    const task = async (): Promise<ToolResult> => {
      if (options.stopSignal?.aborted || prepared.context.signal.aborted) return stopped();
      const latest = { ...prepared.context, ...prepared.context.security?.() };
      const tool = options.tools.get(prepared.call.name);
      // Resolve paths again after waiting: a symlink may have changed while approval was open.
      const request = tool
        ? await permissionRequest(prepared.call, tool, latest)
        : prepared.request;
      const blocked = await recheckPermission(request, latest);
      if (
        request &&
        prepared.request &&
        permissionRequestKey(request) !== permissionRequestKey(prepared.request)
      )
        return denied(
          "The operation's resources or risks changed while it was waiting. Request permission again for the current operation.",
        );
      if (
        request &&
        prepared.revision !== prepared.context.permissions?.revision &&
        prepared.context.permissions?.check(request).policy === "ask"
      )
        return denied(
          "Permission settings changed before execution. Request permission again under the current rules.",
        );
      if (
        prepared.review?.verdict === "allow" &&
        (prepared.intent === undefined || latest.permissionIntent?.() !== prepared.intent)
      )
        return denied("Human authorization changed before execution. Request permission again.");
      return blocked ?? run(prepared.call, latest);
    };
    let result = options.tools.isMutating(prepared.call.name)
      ? await mutex.run(task)
      : await task();
    if (isSubagent) {
      const after = await options.hooks?.run(
        "subagent",
        {
          ...prepared.hookInput,
          subagent: { agent, phase: "stop", output: result.output, ok: result.ok },
        },
        options.signal,
      );
      emitHooks(after, emit);
    }
    const post = await options.hooks?.run(
      "postToolUse",
      {
        ...prepared.hookInput,
        toolOk: result.ok,
        toolOutput: result.output,
        ...(result.error ? { toolError: result.error } : {}),
      },
      options.signal,
    );
    emitHooks(post, emit);
    if (prepared.pre) result = withHookContext(result, prepared.pre);
    if (post) result = withHookContext(result, post);
    if (prepared.feedback !== undefined)
      result = {
        ...result,
        notice: [result.notice, `User feedback:\n${prepared.feedback}`]
          .filter(Boolean)
          .join("\n\n"),
      };
    return result;
  };

  const perform = async (call: ToolCall, shown: ToolCall): Promise<ToolResult> => {
    const scope: CallScope | undefined = options.calls?.open(call.id, options.signal);
    const current = {
      ...context,
      ...context.security?.(),
      signal: scope?.signal ?? options.signal,
    };
    emit({ type: "tool.started", call: shown });
    try {
      const prepared = await prepare(call, current);
      const result = await execute(prepared);
      const final = withPermissionReview(
        scope?.cancelled() ? cancelled(result) : result,
        prepared.review,
      );
      emit({ type: "tool.finished", call: shown, result: final });
      return final;
    } finally {
      scope?.close();
    }
  };

  if (
    !options.parallelTools ||
    calls.length <= 1 ||
    calls.some((call) =>
      ["skill", "module"].includes(options.tools.source(options.tools.canonicalName(call.name))),
    )
  ) {
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      const shown = display[index];
      if (call && shown) results.push(await perform(call, shown));
    }
  } else {
    const settled = await Promise.all(
      calls.map((call, index) => perform(call, display[index] ?? call)),
    );
    results.push(...settled);
  }
}
