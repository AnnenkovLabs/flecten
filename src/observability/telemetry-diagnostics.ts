import type { HarnessConfig } from "../config/schema";
import type { SessionEvent } from "../core/types";
import type { McpServerStatus } from "../mcp/session";
import { isObject } from "../util/json";
import { classifyToolFailureDetail, safeCodeToken } from "./telemetry-errors";
import { normalizeModel, normalizeProvider, normalizeToolName } from "./telemetry-sanitize";
import type { ActiveRun, TelemetryEmit, TelemetryRole } from "./telemetry-tracker";

const TERMINAL_ACCEPTANCE_PHASES = new Set(["accepted", "unconfirmed", "stopped", "error"]);
const MAX_ACCEPTANCE_KEYS = 500;

export interface DiagnosticFallback {
  runSessionId: string;
  role: TelemetryRole;
  provider: string;
  protocol: string;
  model: string;
}

export interface McpHealthSummary {
  servers_total: number;
  mcp_ready_count: number;
  mcp_failed_count: number;
  mcp_degraded_count: number;
  mcp_oauth_pending_count: number;
  mcp_tools_count: number;
}

export function summarizeMcpHealth(
  servers: readonly McpServerStatus[] | undefined,
): McpHealthSummary {
  const list = servers ?? [];
  let ready = 0;
  let failed = 0;
  let degraded = 0;
  let oauthPending = 0;
  let tools = 0;
  for (const server of list) {
    if (server.state === "ready") ready += 1;
    else if (server.state === "failed") failed += 1;
    else if (server.state === "degraded") degraded += 1;
    if (server.oauth) oauthPending += 1;
    tools += server.tools;
  }
  return {
    servers_total: list.length,
    mcp_ready_count: ready,
    mcp_failed_count: failed,
    mcp_degraded_count: degraded,
    mcp_oauth_pending_count: oauthPending,
    mcp_tools_count: tools,
  };
}

export function createActiveRun(params: {
  key: string;
  sessionId: string;
  parentSessionId?: string;
  runSessionId: string;
  role: TelemetryRole;
  now: number;
  provider: string;
  protocol: string;
  model: string;
  reasoning: string;
}): ActiveRun {
  return {
    key: params.key,
    sessionId: params.sessionId,
    ...(params.parentSessionId ? { parentSessionId: params.parentSessionId } : {}),
    runSessionId: params.runSessionId,
    role: params.role,
    startedAt: params.now,
    provider: params.provider,
    protocol: params.protocol,
    model: params.model,
    reasoning: params.reasoning,
    turns: 0,
    toolCalls: 0,
    toolFailures: 0,
    toolCallsRepaired: 0,
    toolCallsRetried: 0,
    activeTools: new Map(),
    compactions: 0,
    compactionFailures: 0,
    retries: 0,
    fallbacks: 0,
    providerTurns: 0,
    providerTurnsFailed: 0,
    providerInvalidFrames: 0,
    providerEmptyResponses: 0,
    messageResets: 0,
    hooksExecuted: 0,
    hooksFailed: 0,
    hooksBlocked: 0,
    translationsCount: 0,
    translationFailuresCount: 0,
    approvalsRequested: 0,
    approvalsDenied: 0,
    subagents: 0,
    hasHtmlSummary: false,
    gracefulStopped: false,
    forceStopped: false,
    phase: "thinking",
  };
}

export function emitRunStartedPayload(
  created: ActiveRun,
  event: Extract<SessionEvent, { type: "session.started" }>,
  emit: TelemetryEmit,
): void {
  emit("run.started", {
    run_session_id: created.runSessionId,
    role: created.role,
    provider: created.provider,
    protocol: created.protocol,
    model: created.model,
    reasoning: created.reasoning,
    has_variant: Boolean(event.variant),
    prompt_version: event.system?.version ?? "unknown",
    prompt_tokens: event.system?.tokens ?? 0,
    prompt_truncated_count: event.system
      ? event.system.parts.filter((part) => part.trimmed || part.omitted).length
      : 0,
    attachment_count: event.attachments?.length ?? 0,
    context_ref_count: event.contexts?.length ?? 0,
    is_resumed: event.resumed === true,
    is_continuation: event.continuation === true,
    is_internal: event.internal === true,
    actor: event.actor ?? "user",
  });
}

export function emitRunFinishedPayload(
  event: Extract<SessionEvent, { type: "session.finished" }>,
  run: ActiveRun | undefined,
  fallback: DiagnosticFallback,
  now: number,
  config: HarnessConfig,
  emit: TelemetryEmit,
): void {
  const usage = event.result.usage;
  const durationMs = run ? Math.max(0, Math.round(now - run.startedAt)) : 0;
  const ttftMs =
    run?.firstTokenAt !== undefined
      ? Math.max(0, Math.round(run.firstTokenAt - run.startedAt))
      : undefined;
  const cacheHitRatio =
    usage.input > 0 ? Number((Math.min(usage.cached, usage.input) / usage.input).toFixed(4)) : 0;
  const costUsd = event.result.budget?.spent.costUsd;
  emit("run.finished", {
    run_session_id: fallback.runSessionId,
    role: fallback.role,
    provider: fallback.provider,
    protocol: fallback.protocol,
    model: fallback.model,
    reasoning: run?.reasoning ?? config.reasoning ?? "auto",
    stop_reason: event.result.stopReason,
    pass: event.result.pass,
    turns: event.result.turns,
    duration_ms: durationMs,
    ...(ttftMs !== undefined ? { ttft_ms: ttftMs } : {}),
    input_tokens: usage.input,
    output_tokens: usage.output,
    cached_tokens: usage.cached,
    cache_write_tokens: usage.cacheWrite ?? 0,
    reasoning_tokens: usage.reasoning ?? 0,
    total_tokens: usage.input + usage.output,
    cache_hit_ratio: cacheHitRatio,
    ...(costUsd !== undefined ? { cost_usd: Number(costUsd.toFixed(6)) } : {}),
    usage_incomplete: event.result.budget?.accounting?.status === "unavailable",
    tool_calls_total: run?.toolCalls ?? 0,
    tool_calls_failed: run?.toolFailures ?? 0,
    tool_calls_repaired: run?.toolCallsRepaired ?? 0,
    tool_calls_retried: run?.toolCallsRetried ?? 0,
    compactions_count: run?.compactions ?? 0,
    compaction_failures_count: run?.compactionFailures ?? 0,
    retries_count: run?.retries ?? 0,
    fallbacks_count: run?.fallbacks ?? 0,
    provider_turns_total: run?.providerTurns ?? 0,
    provider_turns_failed: run?.providerTurnsFailed ?? 0,
    provider_invalid_frames: run?.providerInvalidFrames ?? 0,
    provider_empty_responses: run?.providerEmptyResponses ?? 0,
    message_resets_count: run?.messageResets ?? 0,
    hooks_executed: run?.hooksExecuted ?? 0,
    hooks_failed: run?.hooksFailed ?? 0,
    hooks_blocked: run?.hooksBlocked ?? 0,
    translations_count: run?.translationsCount ?? 0,
    translation_failures_count: run?.translationFailuresCount ?? 0,
    approvals_requested: run?.approvalsRequested ?? 0,
    approvals_denied: run?.approvalsDenied ?? 0,
    subagents_spawned: run?.subagents ?? 0,
    has_html_summary: run?.hasHtmlSummary ?? false,
    was_graceful_stopped: run?.gracefulStopped ?? false,
    was_force_stopped: run?.forceStopped ?? false,
  });
}

export class DiagnosticEventRecorder {
  readonly #seenAcceptances = new Set<string>();

  emitToolFinished(
    event: Extract<SessionEvent, { type: "tool.finished" }>,
    run: ActiveRun | undefined,
    fallback: DiagnosticFallback,
    durationMs: number,
    emit: TelemetryEmit,
  ): void {
    const tool = normalizeToolName(event.call.name);
    const attempts = event.result.attempts ?? 1;
    const repaired = event.result.repaired === true;
    const detail = event.result.ok ? undefined : classifyToolFailureDetail(event.result);
    if (run) {
      if (repaired) run.toolCallsRepaired += 1;
      if (attempts > 1) run.toolCallsRetried += 1;
    }
    emit("tool.executed", {
      run_session_id: fallback.runSessionId,
      tool,
      ok: event.result.ok,
      duration_ms: durationMs,
      role: fallback.role,
      provider: fallback.provider,
      model: fallback.model,
      was_repaired: repaired,
      attempts,
      recovered_by_retry: event.result.ok && attempts > 1,
      truncated: Boolean(event.result.fullOutputPath),
      ...(detail ? { error_kind: detail.error_kind } : {}),
    });
    if (!detail) return;
    emit("tool.failed", {
      run_session_id: fallback.runSessionId,
      tool,
      ...detail,
      was_repaired: repaired,
      attempts,
      turn: run?.turns ?? 0,
      duration_ms: durationMs,
      role: fallback.role,
      provider: fallback.provider,
      model: fallback.model,
    });
  }

  emitProviderResponse(
    event: Extract<SessionEvent, { type: "provider.response" }>,
    run: ActiveRun | undefined,
    fallback: DiagnosticFallback,
    emit: TelemetryEmit,
  ): void {
    const res = event.response;
    const isEmpty =
      res.status === "complete" &&
      res.textBytes === 0 &&
      res.reasoningBytes === 0 &&
      res.toolCalls === 0;
    if (run) {
      run.providerTurns += 1;
      run.providerInvalidFrames += res.invalidFrames;
      run.lastResponseOutcome = res.outcome;
      if (res.status === "failed") run.providerTurnsFailed += 1;
      if (isEmpty) run.providerEmptyResponses += 1;
    }
    if (res.status !== "failed" && res.invalidFrames === 0 && res.usage !== "missing" && !isEmpty) {
      return;
    }
    emit("provider.response.failed", {
      run_session_id: fallback.runSessionId,
      role: fallback.role,
      protocol: res.protocol,
      provider: res.provider ? normalizeProvider(res.provider) : fallback.provider,
      model: res.model
        ? normalizeModel(res.provider ?? fallback.provider, res.model)
        : fallback.model,
      outcome: res.outcome,
      ...(res.originalFinishReason ? { original_finish_reason: res.originalFinishReason } : {}),
      frames: res.frames,
      invalid_frames: res.invalidFrames,
      unsupported_frames: res.unsupportedFrames,
      text_bytes: res.textBytes,
      reasoning_bytes: res.reasoningBytes,
      tool_calls: res.toolCalls,
      terminal: res.terminal,
      is_empty_response: isEmpty,
      usage_status: res.usage,
      duration_ms: Math.round(res.durationMs),
    });
  }

  emitHookFinished(
    event: Extract<SessionEvent, { type: "hook.finished" }>,
    run: ActiveRun | undefined,
    fallback: DiagnosticFallback,
    emit: TelemetryEmit,
  ): void {
    const hook = event.hook;
    const failed = !hook.ok || hook.timedOut === true;
    const blocked = hook.blocked === true;
    if (run) {
      run.hooksExecuted += 1;
      if (failed) run.hooksFailed += 1;
      if (blocked) run.hooksBlocked += 1;
    }
    if (!failed && !blocked) return;
    emit("hook.failed", {
      run_session_id: fallback.runSessionId,
      hook_event: hook.event,
      source_type: hook.source?.type ?? "project",
      ok: hook.ok,
      blocked,
      timed_out: hook.timedOut === true,
      aborted: hook.aborted === true,
      ...(hook.exitCode !== undefined ? { exit_code: hook.exitCode } : {}),
      duration_ms: Math.round(hook.durationMs),
    });
  }

  emitWorkerAcceptance(
    event: Extract<SessionEvent, { type: "worker.acceptance" }>,
    fallback: DiagnosticFallback,
    emit: TelemetryEmit,
  ): void {
    const acc = event.acceptance;
    if (!TERMINAL_ACCEPTANCE_PHASES.has(acc.phase)) return;
    const dedupeKey = `${acc.taskId}:${acc.phase}:${acc.revision}`;
    if (this.#seenAcceptances.has(dedupeKey)) return;
    if (this.#seenAcceptances.size >= MAX_ACCEPTANCE_KEYS) {
      const oldest = this.#seenAcceptances.values().next().value;
      if (oldest !== undefined) this.#seenAcceptances.delete(oldest);
    }
    this.#seenAcceptances.add(dedupeKey);
    let met = 0;
    let open = 0;
    let blocked = 0;
    for (const item of acc.criteria) {
      if (item.status === "met") met += 1;
      else if (item.status === "blocked") blocked += 1;
      else open += 1;
    }
    emit("worker.acceptance", {
      run_session_id: fallback.runSessionId,
      phase: acc.phase,
      revision: acc.revision,
      criteria_total: acc.criteria.length,
      criteria_met: met,
      criteria_open: open,
      criteria_blocked: blocked,
      legacy: acc.legacy,
    });
  }

  emitRunError(
    event: Extract<SessionEvent, { type: "error" }>,
    run: ActiveRun | undefined,
    fallback: DiagnosticFallback,
    emit: TelemetryEmit,
  ): void {
    const firstActiveTool = run?.activeTools.values().next().value?.tool ?? "none";
    emit("run.error", {
      code: event.code,
      ...(event.reason ? { reason: safeCodeToken(event.reason) } : {}),
      ...(typeof event.status === "number" ? { http_status: event.status } : {}),
      ...(event.providerCode ? { provider_code: safeCodeToken(event.providerCode) } : {}),
      ...(event.limit ? { limit_kind: event.limit } : {}),
      provider: fallback.provider,
      model: fallback.model,
      role: fallback.role,
      phase: run?.phase ?? "unknown",
      active_tool: firstActiveTool,
      turns_so_far: run?.turns ?? 0,
      retries_so_far: run?.retries ?? 0,
      fallbacks_so_far: run?.fallbacks ?? 0,
      had_first_token: run?.firstTokenAt !== undefined,
      ...(run?.lastRetryKind ? { last_retry_kind: run.lastRetryKind } : {}),
      ...(run?.lastResponseOutcome
        ? { last_response_outcome: safeCodeToken(run.lastResponseOutcome) }
        : {}),
      ...(event.sessionId ? { run_session_id: fallback.runSessionId } : {}),
    });
  }
}

export function emitSubagentFailureKind(
  result: { ok: boolean; data?: unknown },
  cancelled: boolean,
): string | undefined {
  if (result.ok) return undefined;
  if (cancelled) return "cancelled";
  if (isObject(result.data)) {
    const raw =
      typeof result.data.errorKind === "string"
        ? result.data.errorKind
        : typeof result.data.kind === "string"
          ? result.data.kind
          : undefined;
    if (raw) return safeCodeToken(raw) || "execution_error";
  }
  return "execution_error";
}
