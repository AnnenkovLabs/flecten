import type { HarnessConfig } from "../config/schema";
import type { Event, SessionEvent } from "../core/types";
import { redact } from "../util/redact";
import {
  createActiveRun,
  DiagnosticEventRecorder,
  type DiagnosticFallback,
  emitRunFinishedPayload,
  emitRunStartedPayload,
  emitSubagentFailureKind,
} from "./telemetry-diagnostics";
import { safeCodeToken } from "./telemetry-errors";
import { normalizeModel, normalizeProvider, normalizeToolName } from "./telemetry-sanitize";

export type TelemetryRole = "single" | "talker" | "worker" | "subagent";
export type TelemetryEmit = (event: string, properties: Record<string, unknown>) => void;

export interface ActiveRun {
  key: string;
  sessionId: string;
  parentSessionId?: string;
  runSessionId: string;
  role: TelemetryRole;
  startedAt: number;
  firstTokenAt?: number;
  provider: string;
  protocol: string;
  model: string;
  reasoning: string;
  turns: number;
  toolCalls: number;
  toolFailures: number;
  toolCallsRepaired: number;
  toolCallsRetried: number;
  activeTools: Map<string, { tool: string; startedAt: number }>;
  compactions: number;
  compactionFailures: number;
  retries: number;
  fallbacks: number;
  providerTurns: number;
  providerTurnsFailed: number;
  providerInvalidFrames: number;
  providerEmptyResponses: number;
  messageResets: number;
  hooksExecuted: number;
  hooksFailed: number;
  hooksBlocked: number;
  translationsCount: number;
  translationFailuresCount: number;
  lastRetryKind?: string;
  lastResponseOutcome?: string;
  approvalsRequested: number;
  approvalsDenied: number;
  subagents: number;
  hasHtmlSummary: boolean;
  gracefulStopped: boolean;
  forceStopped: boolean;
  phase: "thinking" | "streaming" | "tool" | "approval" | "retry";
}

export interface TrackerTotals {
  runsStarted: number;
  runsCompleted: number;
  toolCalls: number;
  errors: number;
}

const MAX_ALIASES = 200;

export class TelemetryTracker {
  readonly activeRuns = new Map<string, ActiveRun>();
  readonly manualCompactions = new Set<string>();
  readonly totals: TrackerTotals = {
    runsStarted: 0,
    runsCompleted: 0,
    toolCalls: 0,
    errors: 0,
  };
  readonly #aliases = new Map<string, string>();
  readonly #approvals = new Map<string, { at: number; action: string; tool: string }>();
  readonly #subagents = new Map<string, { startedAt: number; sessionId: string }>();
  readonly #diagnostics = new DiagnosticEventRecorder();
  readonly #now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  aliasOf(sessionId: string): string {
    const existing = this.#aliases.get(sessionId);
    if (existing) return existing;
    if (this.#aliases.size >= MAX_ALIASES) {
      const oldest = this.#aliases.keys().next().value;
      if (oldest !== undefined) this.#aliases.delete(oldest);
    }
    const created = `rs_${crypto.randomUUID().slice(0, 12)}`;
    this.#aliases.set(sessionId, created);
    return created;
  }

  findRuns(sessionId?: string, target?: "session" | "worker"): ActiveRun[] {
    const all = [...this.activeRuns.values()];
    if (all.length === 0) return [];
    const matching = sessionId
      ? all.filter((run) => run.sessionId === sessionId || run.parentSessionId === sessionId)
      : all;
    const pool = matching.length > 0 ? matching : all;
    if (target === "worker") {
      const workers = pool.filter((run) => run.role === "worker");
      return workers.length > 0 ? workers : pool;
    }
    return pool;
  }

  findTool(callId: string): { run: ActiveRun; tool: string; startedAt: number } | undefined {
    for (const run of this.activeRuns.values()) {
      const entry = run.activeTools.get(callId);
      if (entry) return { run, tool: entry.tool, startedAt: entry.startedAt };
    }
    return undefined;
  }

  handleEvent(event: Event, emit: TelemetryEmit, config: HarnessConfig): void {
    if (event.type === "worker.event") {
      this.#handleLeaf(event.event, "worker", event.sessionId, emit, config);
      return;
    }
    if (event.type === "subagent.event") {
      this.#handleLeaf(event.event, "subagent", event.sessionId, emit, config, event.id);
      return;
    }
    this.#handleLeaf(event, undefined, undefined, emit, config);
  }

  #handleLeaf(
    event: SessionEvent,
    forcedRole: TelemetryRole | undefined,
    parentSessionId: string | undefined,
    emit: TelemetryEmit,
    config: HarnessConfig,
    subagentId?: string,
  ): void {
    if (event.type === "subagent.event") return;
    if (event.type === "tool_call.progress" || event.type === "tool.output") return;

    const now = this.#now();
    const run = this.#resolveRun(event.sessionId, forcedRole, subagentId);
    if (
      event.type === "message.started" ||
      event.type === "message.delta" ||
      event.type === "reasoning.delta"
    ) {
      if (run) {
        run.firstTokenAt ??= now;
        run.phase = "streaming";
      }
      return;
    }

    switch (event.type) {
      case "session.started": {
        const role: TelemetryRole = forcedRole ?? event.role ?? "single";
        const key = `${subagentId ?? event.sessionId}:${role}`;
        const created = createActiveRun({
          key,
          sessionId: event.sessionId,
          ...(parentSessionId ? { parentSessionId } : {}),
          runSessionId: this.aliasOf(parentSessionId ?? event.sessionId),
          role,
          now,
          provider: normalizeProvider(event.provider),
          protocol: config.providers[event.provider]?.protocol ?? "unknown",
          model: normalizeModel(event.provider, event.model),
          reasoning: event.reasoning ?? "auto",
        });
        this.activeRuns.set(key, created);
        this.totals.runsStarted += 1;
        emitRunStartedPayload(created, event, emit);
        return;
      }
      case "turn.started":
        if (run) {
          run.turns = Math.max(run.turns, event.turn);
          run.phase = "thinking";
        }
        return;
      case "message.finished":
        if (run && event.summary) run.hasHtmlSummary = true;
        return;
      case "tool.started": {
        const tool = normalizeToolName(event.call.name);
        if (run) {
          run.activeTools.set(event.call.id, { tool, startedAt: now });
          run.phase = "tool";
        }
        return;
      }
      case "tool.finished": {
        const started = run?.activeTools.get(event.call.id);
        run?.activeTools.delete(event.call.id);
        const durationMs =
          event.result.durationMs ??
          (started ? Math.max(0, Math.round(now - started.startedAt)) : 0);
        this.totals.toolCalls += 1;
        if (run) {
          run.toolCalls += 1;
          if (!event.result.ok) run.toolFailures += 1;
        }
        this.#diagnostics.emitToolFinished(
          event,
          run,
          this.#fallback(event.sessionId, run, forcedRole, parentSessionId, config),
          durationMs,
          emit,
        );
        return;
      }
      case "context.compacted": {
        if (run) run.compactions += 1;
        const isManual =
          this.manualCompactions.delete(event.sessionId) ||
          (parentSessionId ? this.manualCompactions.delete(parentSessionId) : false);
        const reductionRatio =
          event.before && event.before > 0 && event.after !== undefined
            ? Number(((event.before - event.after) / event.before).toFixed(4))
            : undefined;
        emit("context.compacted", {
          run_session_id: run?.runSessionId ?? this.aliasOf(parentSessionId ?? event.sessionId),
          role: run?.role ?? forcedRole ?? "single",
          source: event.source ?? "model",
          pruned: event.pruned,
          ...(event.before !== undefined ? { tokens_before: event.before } : {}),
          ...(event.after !== undefined ? { tokens_after: event.after } : {}),
          ...(reductionRatio !== undefined ? { reduction_ratio: reductionRatio } : {}),
          ...(event.page !== undefined ? { page: event.page } : {}),
          is_manual: isManual,
        });
        return;
      }
      case "context.summary.failed":
        if (run) run.compactionFailures += 1;
        emit("context.summary.failed", {
          run_session_id: run?.runSessionId ?? this.aliasOf(parentSessionId ?? event.sessionId),
          role: run?.role ?? forcedRole ?? "single",
          stage: event.stage,
          reason: safeCodeToken(event.reason) || "unknown",
          provider: run?.provider ?? normalizeProvider(config.provider),
          model: run?.model ?? normalizeModel(config.provider, config.model),
        });
        return;
      case "provider.retry":
        if (run) {
          run.retries += 1;
          run.phase = "retry";
          run.lastRetryKind = event.kind;
        }
        emit("provider.retry", {
          run_session_id: run?.runSessionId ?? this.aliasOf(parentSessionId ?? event.sessionId),
          role: run?.role ?? forcedRole ?? "single",
          kind: event.kind,
          attempt: event.attempt,
          delay_ms: event.delayMs,
          provider: run?.provider ?? normalizeProvider(config.provider),
          protocol: run?.protocol ?? config.providers[config.provider]?.protocol ?? "unknown",
          model: run?.model ?? normalizeModel(config.provider, config.model),
        });
        return;
      case "model.fallback": {
        const fromProvider = run?.provider ?? normalizeProvider(config.provider);
        const fromModel = run?.model ?? normalizeModel(config.provider, config.model);
        const toProvider = normalizeProvider(event.provider);
        const toModel = normalizeModel(event.provider, event.model);
        if (run) {
          run.fallbacks += 1;
          run.provider = toProvider;
          run.model = toModel;
          run.protocol = config.providers[event.provider]?.protocol ?? run.protocol;
        }
        emit("model.fallback", {
          run_session_id: run?.runSessionId ?? this.aliasOf(parentSessionId ?? event.sessionId),
          role: run?.role ?? forcedRole ?? "single",
          from_provider: fromProvider,
          from_model: fromModel,
          to_provider: toProvider,
          to_model: toModel,
          reason: redact(event.reason).slice(0, 64),
        });
        return;
      }
      case "provider.response":
        this.#diagnostics.emitProviderResponse(
          event,
          run,
          this.#fallback(event.sessionId, run, forcedRole, parentSessionId, config),
          emit,
        );
        return;
      case "input.translated":
        if (run) run.translationsCount += 1;
        return;
      case "translation.failed": {
        if (run) run.translationFailuresCount += 1;
        const fb = this.#fallback(event.sessionId, run, forcedRole, parentSessionId, config);
        emit("translation.failed", {
          run_session_id: fb.runSessionId,
          role: fb.role,
          provider: fb.provider,
          model: fb.model,
        });
        return;
      }
      case "message.reset": {
        if (run) run.messageResets += 1;
        const fb = this.#fallback(event.sessionId, run, forcedRole, parentSessionId, config);
        emit("turn.message_reset", {
          run_session_id: fb.runSessionId,
          role: fb.role,
          provider: fb.provider,
          model: fb.model,
          reason: safeCodeToken(event.reason) || "unknown",
          turn: run?.turns ?? 0,
        });
        return;
      }
      case "hook.finished":
        this.#diagnostics.emitHookFinished(
          event,
          run,
          this.#fallback(event.sessionId, run, forcedRole, parentSessionId, config),
          emit,
        );
        return;
      case "worker.acceptance":
        this.#diagnostics.emitWorkerAcceptance(
          event,
          this.#fallback(event.sessionId, run, forcedRole, parentSessionId, config),
          emit,
        );
        return;
      case "job.finished":
        emit("background_job.finished", {
          run_session_id: run?.runSessionId ?? this.aliasOf(parentSessionId ?? event.sessionId),
          status: event.job.status,
          ok: event.job.exitCode === 0,
          ...(event.job.exitCode !== null ? { exit_code: event.job.exitCode } : {}),
          duration_ms: Math.round(event.job.durationMs),
        });
        return;
      case "usage.unavailable": {
        const rawProvider = event.provider ?? config.provider;
        emit("usage.unavailable", {
          run_session_id: run?.runSessionId ?? this.aliasOf(parentSessionId ?? event.sessionId),
          role: run?.role ?? forcedRole ?? "single",
          provider: event.provider
            ? normalizeProvider(event.provider)
            : (run?.provider ?? "unknown"),
          model: event.model ? normalizeModel(rawProvider, event.model) : (run?.model ?? "unknown"),
          purpose: event.purpose ?? "primary",
        });
        return;
      }
      case "approval.requested":
        this.#approvals.set(event.approval.id, {
          at: now,
          action: event.approval.action,
          tool: normalizeToolName(event.approval.tool),
        });
        if (run) {
          run.approvalsRequested += 1;
          run.phase = "approval";
        }
        return;
      case "approval.resolved": {
        const pending = this.#approvals.get(event.id);
        this.#approvals.delete(event.id);
        if (run && event.choice === "deny") run.approvalsDenied += 1;
        emit("feature.approval", {
          run_session_id: run?.runSessionId ?? this.aliasOf(parentSessionId ?? event.sessionId),
          action_kind: pending?.action ?? "unknown",
          tool: pending?.tool ?? "unknown",
          choice: event.choice,
          by: event.by,
          wait_ms: pending ? Math.max(0, Math.round(now - pending.at)) : 0,
        });
        return;
      }
      case "twin.activity":
        if (event.activity.state === "running") return;
        emit("feature.twin", {
          action: "barge_in",
          phase: event.activity.phase,
          state: event.activity.state,
          emotion: event.activity.emotion,
          corrections: event.activity.corrections,
          provider: normalizeProvider(event.activity.provider),
          model: normalizeModel(event.activity.provider, event.activity.model),
        });
        return;
      case "subagent.started":
        this.#subagents.set(event.subagent.id, { startedAt: now, sessionId: event.sessionId });
        if (run) run.subagents += 1;
        return;
      case "subagent.finished": {
        const sub = this.#subagents.get(event.id);
        this.#subagents.delete(event.id);
        this.activeRuns.delete(`${event.id}:subagent`);
        const errorKind = emitSubagentFailureKind(event.result, event.cancelled);
        emit("feature.subagent", {
          action: "finished",
          ok: event.result.ok,
          cancelled: event.cancelled,
          ...(errorKind ? { error_kind: errorKind } : {}),
          duration_ms: sub ? Math.max(0, Math.round(now - sub.startedAt)) : 0,
          total_tokens: event.result.usage.input + event.result.usage.output,
          cached_tokens: event.result.usage.cached,
        });
        return;
      }
      case "run.interrupted":
        emit("run.interrupted", {
          run_session_id: run?.runSessionId ?? this.aliasOf(parentSessionId ?? event.sessionId),
          role: run?.role ?? forcedRole ?? "single",
          reason: safeCodeToken(event.reason) || "unknown",
        });
        return;
      case "error":
        this.totals.errors += 1;
        this.#diagnostics.emitRunError(
          event,
          run,
          this.#fallback(event.sessionId, run, forcedRole, parentSessionId, config),
          emit,
        );
        return;
      case "session.finished": {
        this.totals.runsCompleted += 1;
        emitRunFinishedPayload(
          event,
          run,
          this.#fallback(event.sessionId, run, forcedRole, parentSessionId, config),
          now,
          config,
          emit,
        );
        if (run) this.activeRuns.delete(run.key);
        return;
      }
    }
  }

  #fallback(
    sessionId: string | undefined,
    run: ActiveRun | undefined,
    forcedRole: TelemetryRole | undefined,
    parentSessionId: string | undefined,
    config: HarnessConfig,
  ): DiagnosticFallback {
    return {
      runSessionId: run?.runSessionId ?? this.aliasOf(parentSessionId ?? sessionId ?? "global"),
      role: run?.role ?? forcedRole ?? "single",
      provider: run?.provider ?? normalizeProvider(config.provider),
      protocol: run?.protocol ?? config.providers[config.provider]?.protocol ?? "unknown",
      model: run?.model ?? normalizeModel(config.provider, config.model),
    };
  }

  #resolveRun(
    sessionId: string | undefined,
    forcedRole: TelemetryRole | undefined,
    subagentId?: string,
  ): ActiveRun | undefined {
    if (!sessionId && !subagentId) return undefined;
    if (subagentId) return this.activeRuns.get(`${subagentId}:subagent`);
    if (forcedRole) return this.activeRuns.get(`${sessionId}:${forcedRole}`);
    for (const role of ["talker", "single", "worker", "subagent"] as const) {
      const found = this.activeRuns.get(`${sessionId}:${role}`);
      if (found) return found;
    }
    return undefined;
  }
}
