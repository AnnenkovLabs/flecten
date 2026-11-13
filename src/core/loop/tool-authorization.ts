import type { ApprovalOutcome, PermissionRequest } from "../../security/types";
import type { ToolContext } from "../../tools/types";
import type { ToolCall, ToolResult } from "../types";
import { permissionRequest, shellText } from "./permission-request";
import { type PermissionReview, reviewPermission } from "./permission-review";
import type { ToolExecutionOptions } from "./tools";
import type { LoopEvent } from "./types";

export function denied(reason: string, kind: "permission" | "sandbox" = "permission"): ToolResult {
  return { ok: false, output: "", error: reason, data: { kind } };
}

async function sandbox(
  request: PermissionRequest,
  context: ToolContext,
): Promise<ToolResult | undefined> {
  const policy = context.sandbox;
  if (!policy) return undefined;
  if (request.action === "read" || request.action === "write" || request.tool === "lsp") {
    const action = request.action === "write" ? "write" : "read";
    if (request.tool === "memory") {
      const check = await policy.checkMemory(action);
      if (!check.allowed) return denied(check.reason, "sandbox");
    } else
      for (const path of request.paths ?? []) {
        const check =
          action === "read" ? await policy.checkRead(path) : await policy.checkWrite(path);
        if (!check.allowed) return denied(check.reason, "sandbox");
      }
  }
  if (request.action === "shell") {
    const args = request.args ?? {};
    const cwd = typeof args.cwd === "string" ? args.cwd : context.cwd;
    const check = await policy.checkRead(cwd);
    if (!check.allowed) return denied(check.reason, "sandbox");
    const command = request.tool === "lsp" ? undefined : shellText(request);
    if (command !== undefined) {
      const shell = policy.checkShell(command);
      if (!shell.allowed) return denied(shell.reason, "sandbox");
    }
  }
  if (request.action === "network") {
    const url = request.args?.url;
    let host = "web search";
    if (typeof url === "string") {
      try {
        host = new URL(url).hostname;
      } catch {
        return denied("Сеть: некорректный URL.", "sandbox");
      }
    }
    const check = policy.checkNetwork(host);
    if (!check.allowed) return denied(check.reason, "sandbox");
  }
  return undefined;
}

/** Checked again inside the mutation lock, so a grant cannot outlive a newly applied deny. */
export async function recheckPermission(
  request: PermissionRequest | undefined,
  context: ToolContext,
): Promise<ToolResult | undefined> {
  if (context.signal.aborted) return denied("Tool call cancelled before execution");
  if (!request) return undefined;
  const blocked = await sandbox(request, context);
  if (blocked) return blocked;
  const decision = context.permissions?.check(request);
  return decision?.policy === "deny" ? denied(decision.reason) : undefined;
}

export async function authorizeCall(
  call: ToolCall,
  options: ToolExecutionOptions,
  context: ToolContext,
  emit: (event: LoopEvent) => void,
): Promise<{
  request?: PermissionRequest;
  error?: ToolResult;
  feedback?: string;
  review?: PermissionReview;
}> {
  const tool = options.tools.get(call.name);
  if (!tool) return { error: denied(`Unknown tool: ${call.name}`) };
  let request: PermissionRequest | undefined;
  try {
    request = await permissionRequest(call, tool, context);
  } catch (error) {
    return {
      error: {
        ok: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
        data: { errorKind: "validation" },
      },
    };
  }
  if (!request) return {};
  const blocked = await recheckPermission(request, context);
  if (blocked) return { request, error: blocked };
  const engine = context.permissions;
  if (!engine) return { request };
  const inspected = engine.check(request);
  const hook = await options.hooks?.run(
    "permission",
    {
      sessionId: context.sessionId,
      cwd: context.cwd,
      toolName: call.name,
      toolArgs: call.args,
      permission: {
        action: request.action,
        policy: inspected.policy,
        tool: call.name,
        ...(request.target ? { target: request.target } : {}),
        reason: inspected.reason,
      },
    },
    context.signal,
  );
  for (const run of hook?.runs ?? []) emit({ type: "hook.finished", hook: run });
  if (hook?.blocked)
    return { request, error: denied(hook.reason ?? "Permission hook denied the call") };
  if (context.signal.aborted)
    return { request, error: denied("Tool call cancelled while checking permission") };
  const current = engine.check(request);
  let review: PermissionReview | undefined;
  if (current.review) {
    const revision = engine.revision;
    review = await reviewPermission(request, options, context, emit);
    if (context.signal.aborted || options.stopSignal?.aborted)
      return {
        request,
        review,
        error: denied("Tool call cancelled during automatic permission review"),
      };
    if (revision !== engine.revision)
      return {
        request,
        review,
        error: denied(
          "Permission settings changed during automatic review. Request permission again.",
        ),
      };
    const rechecked = await recheckPermission(request, context);
    if (rechecked) return { request, review, error: rechecked };
    if (review.verdict === "allow" && engine.check(request).review) return { request, review };
  }
  // The hook may change policy. Pending state is created only for a real, cancellable waiter.
  const decision = context.approvals ? engine.decide(request) : engine.check(request);
  const audit = review ? { review } : {};
  if (decision.policy === "deny") return { request, ...audit, error: denied(decision.reason) };
  if (decision.policy !== "ask") return { request, ...audit };
  if (!context.approvals || !decision.approvalId)
    return {
      request,
      ...audit,
      error: {
        ...denied(decision.reason),
        data: {
          kind: "approval",
          action: request.action,
          tool: request.tool,
          target: request.target ?? "",
          reason: decision.reason,
        },
      },
    };
  const outcome = await context.approvals.wait(
    {
      id: decision.approvalId,
      request,
      reason: decision.reason,
      callId: call.id,
      ...(decision.humanOnly ? { humanOnly: true } : {}),
    },
    options.stopSignal ? AbortSignal.any([context.signal, options.stopSignal]) : context.signal,
    engine,
  );
  return outcome.choice === "deny"
    ? {
        request,
        ...audit,
        error: {
          ...denied(refusal(outcome, decision.reason)),
          data: { kind: "permission", outcome: outcome.by, approvalId: decision.approvalId },
        },
      }
    : {
        request,
        ...audit,
        ...(outcome.by === "user" && outcome.feedback !== undefined
          ? { feedback: outcome.feedback }
          : {}),
      };
}

function refusal(outcome: ApprovalOutcome, reason: string): string {
  if (outcome.by === "timeout")
    return `Нет ответа пользователя на запрос разрешения, вызов отклонён. ${reason} Выберите безопасный путь или продолжите другую часть задачи.`;
  if (outcome.by === "aborted") return "Прогон остановлен, пока вызов ждал разрешения.";
  if (outcome.by === "policy") return `Права изменились, вызов запрещён. ${reason}`;
  if (outcome.by === "persistence")
    return "Не удалось сохранить разрешение. Вызов не выполнен; устраните ошибку сохранения или запросите одноразовое разрешение.";
  return `Пользователь отклонил вызов. Не достигайте того же результата обходным инструментом. Продолжайте только с существенно более безопасным действием. ${reason}${outcome.by === "user" && outcome.feedback !== undefined ? `\n\nUser feedback:\n${outcome.feedback}` : ""}`;
}
