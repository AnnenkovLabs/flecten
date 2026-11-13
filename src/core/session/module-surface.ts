import { ToolExecutionDeadline } from "../../tools/execution-deadline";
import { ToolRegistry } from "../../tools/registry";
import type { Tool, ToolContext } from "../../tools/types";
import { ReadTracker } from "../../tools/util/read-tracker";
import { executeCalls } from "../loop/tools";
import type { ModuleSurfaceInput } from "../modules/types";
import type { ImagePart, ToolResult } from "../types";
import { sessionHookRunner } from "./hooks";
import { mapLoopEvent } from "./loop-events";
import { toolMediaOptions } from "./media";
import type { SessionRuntime } from "./runtime";

/** Surface RPC enters the same tool executor as model calls, including per-session approvals. */
export async function invokeModuleSurface(
  runtime: SessionRuntime,
  input: ModuleSurfaceInput,
): Promise<ToolResult & { media?: ImagePart[] }> {
  const { options } = runtime;
  if (!options.modules) throw new Error("Module runtime is unavailable");
  const sessionId = runtime.reserveSessionId();
  const parent = runtime.active()?.controller.signal ?? new AbortController().signal;
  const deadline = new ToolExecutionDeadline(parent, 300_000);
  const signal = deadline.signal;
  const hooks = sessionHookRunner(
    options.hooks,
    sessionId,
    options.cwd,
    runtime.emit,
    options.modules,
  ).runner;
  const context: ToolContext = deadline.scope({
    invocationOrigin: "module-surface",
    saveMedia: toolMediaOptions(options, sessionId).saveMedia,
    cwd: options.cwd,
    sessionId,
    signal,
    logDir: options.logDir(sessionId),
    limits: options.limits,
    reads: new ReadTracker(),
    terminals: runtime.terminals,
    ...(options.permissions ? { permissions: options.permissions } : {}),
    ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    ...(options.osSandbox ? { osSandbox: options.osSandbox } : {}),
    ...(options.secrets ? { secrets: options.secrets() } : {}),
    ...(options.approvalTimeoutMs === 0 ? {} : { approvals: runtime.approvals.gate(sessionId) }),
    ...(options.checkpoints ? { checkpoints: options.checkpoints } : {}),
    ...(options.shellCheckpoints ? { shellCheckpoints: options.shellCheckpoints } : {}),
  });
  context.invokeTool = async (tool: Tool, args: unknown, nestedContext = context) => {
    const results: ToolResult[] = [];
    await executeCalls(
      [{ id: `module-ui-${input.request.id}`, name: tool.name, args }],
      {
        tools: new ToolRegistry([tool], { limits: options.limits }),
        toolContext: nestedContext,
        signal: nestedContext.signal,
        calls: runtime.calls,
        parallelTools: false,
        ...(hooks ? { hooks } : {}),
      },
      (event) => {
        // UI requests are not model tool calls; persisting orphan tool results would break replay.
        if (event.type === "hook.finished") runtime.emit(mapLoopEvent(event, sessionId));
      },
      results,
    );
    return results[0] ?? { ok: false, output: "", error: "Module tool did not return" };
  };
  const expired = Promise.withResolvers<ToolResult>();
  const abort = () =>
    expired.resolve({
      ok: false,
      output: "",
      error: parent.aborted ? "Module request aborted" : "Module execution timed out",
      data: { errorKind: parent.aborted ? "aborted" : "timeout" },
    });
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let result: ToolResult;
  try {
    result = await Promise.race([options.modules.invokeSurface(input, context), expired.promise]);
  } finally {
    signal.removeEventListener("abort", abort);
    deadline.cancel();
  }
  // Hydrate only for this authorized response. Bytes never enter tool logs or the transcript.
  if (!result.attachments?.length) return result;
  const media = await toolMediaOptions(options, sessionId).loadMedia(result.attachments);
  return { ...result, media };
}
