import { permissionRequestKey } from "../../security/permission-request-key";
import { ProtectedOutputBuffer } from "../../security/provider-secrets/output-buffer";
import { restoreToolArguments } from "../../security/provider-secrets/tool-arguments";
import type { PermissionRequest } from "../../security/types";
import { ToolRegistry } from "../../tools/registry";
import type { ToolContext } from "../../tools/types";
import { isInside } from "../../tools/util/paths";
import { isObject } from "../../util/json";
import { markdownData } from "../../util/markdown";
import { Mutex } from "../../util/mutex";
import type { HookOutcome } from "../hooks/types";
import type { ToolCall, ToolResult } from "../types";
import type { CallScope } from "./calls";
import { externalDirectories, externalRequest, withExternalAccess } from "./external-access";
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
      "User canceled this tool call; the process was stopped. Do not retry it without a new reason.",
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
  const inputs = calls.map((call) => options.tools.prepare(call));
  const pageGuard = options.toolContext.contextPages?.guard(
    calls.map((call, index) => {
      const candidate = inputs[index]?.call ?? call;
      return { ...candidate, name: options.tools.canonicalName(candidate.name) };
    }),
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
    providerProtection: options.provider?.protection ?? options.toolContext.providerProtection,
  };
  if (context.providerProtection)
    context.secrets = [...(context.secrets ?? []), ...context.providerProtection.vault.values];
  const protection = context.providerProtection;
  const hooks = options.hooks;
  if (protection && hooks)
    options = {
      ...options,
      hooks: {
        async run(event, input, signal) {
          return protection.vault.protect(
            await hooks.run(event, protection.vault.protect(input), signal),
          );
        },
      },
    };
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
    const protection = callContext.providerProtection;
    if (protection) {
      try {
        const name = options.tools.canonicalName(call.name);
        const kind = options.tools.source(name) === "builtin" ? name : "external";
        call = { ...call, args: restoreToolArguments(protection.vault, kind, call.args) };
      } catch (error) {
        return {
          call,
          context: callContext,
          hookInput: {
            sessionId: context.sessionId,
            cwd: context.cwd,
            toolName: call.name,
            toolArgs: call.args,
          },
          denied: denied(
            error instanceof Error ? error.message : "Invalid provider secret reference",
          ),
        };
      }
    }
    const normalized = options.tools.prepare(call);
    if (normalized.call) call = normalized.call;
    const hookInput = {
      sessionId: context.sessionId,
      cwd: context.cwd,
      toolName: call.name,
      toolArgs: protection ? protection.vault.protect(call.args) : call.args,
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
    const output = current.providerProtection
      ? new ProtectedOutputBuffer((text) => current.providerProtection?.vault.protect(text) ?? text)
      : undefined;
    const callContext = {
      ...current,
      invokeTool: async (
        tool: import("../../tools/types").Tool,
        args: unknown,
        nestedContext: ToolContext = current,
      ): Promise<ToolResult> => {
        const nested: ToolResult[] = [];
        const { contextPages: _pages, ...isolatedContext } = nestedContext;
        await executeCalls(
          [{ id: `${call.id}-${crypto.randomUUID()}`, name: tool.name, args }],
          {
            ...options,
            tools: new ToolRegistry([tool], { limits: context.limits }),
            toolContext: isolatedContext,
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
      reportOutput: (text: string) => {
        if (output) output.push(text);
        else emit({ type: "tool.output", callId: call.id, text });
      },
    };
    try {
      return await options.tools.run(call, callContext);
    } finally {
      const text = output?.finish();
      if (text) emit({ type: "tool.output", callId: call.id, text });
    }
  };

  const execute = async (prepared: PreparedCall): Promise<ToolResult> => {
    if (options.stopSignal?.aborted || prepared.context.signal.aborted) return stopped();
    if (prepared.denied) return prepared.denied;
    if (options.tools.canonicalName(prepared.call.name) === "done") {
      const onlyCompletionCalls = calls.every((c) =>
        ["done", "criterion", "context"].includes(options.tools.canonicalName(c.name)),
      );
      if (!onlyCompletionCalls) {
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
      const latest = withExternalAccess({ ...prepared.context, ...prepared.context.security?.() });
      const tool = options.tools.get(prepared.call.name);
      // Resolve paths again after waiting: a symlink may have changed while approval was open.
      const request = tool
        ? await permissionRequest(prepared.call, tool, latest)
        : prepared.request;
      if (request) {
        const roots = await externalDirectories(request, latest);
        for (const root of roots) {
          const decision = latest.permissions?.check(externalRequest(request, root));
          if (
            decision?.policy === "deny" ||
            (decision?.policy === "ask" && prepared.revision !== latest.permissions?.revision)
          )
            return denied(decision.reason);
          if (!isInside(latest.cwd, root, latest.authorizedExternalPaths))
            return denied("Directory access changed before execution. Request access again.");
        }
      }
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
    const canonical = options.tools.canonicalName(prepared.call.name);
    const needsLock = options.tools.isMutating(canonical);
    let taskRan = false;
    const runTask = async (): Promise<ToolResult> => {
      if (options.stopSignal?.aborted) return stopped();
      taskRan = true;
      return task();
    };
    let result = needsLock
      ? await mutex.run(runTask).catch((err: unknown) => {
          if (options.stopSignal?.aborted) return stopped();
          throw err;
        })
      : await runTask();
    if (isSubagent && taskRan) {
      const after = await options.hooks?.run(
        "subagent",
        {
          ...prepared.hookInput,
          subagent: { agent, phase: "stop", output: result.output, ok: result.ok },
        },
        prepared.context.signal,
      );
      emitHooks(after, emit);
    }
    const post = taskRan
      ? await options.hooks?.run(
          "postToolUse",
          {
            ...prepared.hookInput,
            toolOk: result.ok,
            toolOutput: result.output,
            ...(result.error ? { toolError: result.error } : {}),
          },
          prepared.context.signal,
        )
      : undefined;
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
      const reviewed = withPermissionReview(
        scope?.cancelled() ? cancelled(result) : result,
        prepared.review,
      );
      const final = current.providerProtection
        ? current.providerProtection.vault.protect(reviewed)
        : reviewed;
      emit({ type: "tool.finished", call: shown, result: final });
      return final;
    } finally {
      scope?.close();
    }
  };

  const canRunParallelBatch =
    options.parallelTools &&
    calls.length > 1 &&
    !calls.some((call) => {
      const canonical = options.tools.canonicalName(call.name);
      return (
        ["skill", "module"].includes(options.tools.source(canonical)) ||
        ["context", "criterion", "done"].includes(canonical)
      );
    });
  if (canRunParallelBatch) {
    const settled = await Promise.all(
      calls.map((call, index) => perform(call, display[index] ?? call)),
    );
    results.push(...settled);
    return;
  }
  const firstCall = calls[0];
  const firstCanonical = firstCall ? options.tools.canonicalName(firstCall.name) : undefined;
  const tailCalls = calls.slice(1);
  const canParallelizeTailAfterContextBegin =
    options.parallelTools &&
    calls.length > 2 &&
    firstCanonical === "context" &&
    isObject(firstCall?.args) &&
    firstCall.args.op === "begin" &&
    tailCalls.every((call) => {
      const canonical = options.tools.canonicalName(call.name);
      return (
        !["skill", "module"].includes(options.tools.source(canonical)) &&
        !["context", "criterion", "done"].includes(canonical)
      );
    });
  if (canParallelizeTailAfterContextBegin && firstCall) {
    const firstResult = await perform(firstCall, display[0] ?? firstCall);
    results.push(firstResult);
    if (!firstResult.ok) {
      const error = "Start one small logical page with context begin before using work tools.";
      for (const [i, call] of tailCalls.entries()) {
        const shown = display[i + 1] ?? call;
        const result: ToolResult = { ok: false, output: "", error };
        emit({ type: "tool.started", call: shown });
        emit({ type: "tool.finished", call: shown, result });
        results.push(result);
      }
      return;
    }
    const settled = await Promise.all(
      tailCalls.map((call, index) => perform(call, display[index + 1] ?? call)),
    );
    results.push(...settled);
  } else {
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      const shown = display[index];
      if (call && shown) results.push(await perform(call, shown));
    }
  }
}
