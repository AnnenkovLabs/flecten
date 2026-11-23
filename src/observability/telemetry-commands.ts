import type { HarnessConfig } from "../config/schema";
import type { McpServerStatus } from "../mcp/session";
import { isObject } from "../util/json";
import { summarizeMcpHealth } from "./telemetry-diagnostics";
import { classifyFailure, safeCodeToken } from "./telemetry-errors";
import { normalizeModel, normalizeProvider } from "./telemetry-sanitize";
import type { TelemetryEmit, TelemetryTracker } from "./telemetry-tracker";

export interface CommandOutcome {
  ok: boolean;
  durationMs: number;
  reply?: Record<string, unknown>;
  error?: unknown;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function commandSubsystem(type: string): string {
  const dot = type.indexOf(".");
  if (dot <= 0) return type;
  const prefix = type.slice(0, dot);
  if (prefix === "files") return "ide";
  if (prefix === "trust") return "security";
  if (prefix === "context") return type === "context.pull-request" ? "extension" : "context";
  return prefix;
}

function emitCommandHealthDiagnostics(
  input: Record<string, unknown> & { type: string },
  outcome: CommandOutcome,
  emit: TelemetryEmit,
  config: HarnessConfig,
): void {
  const failure = !outcome.ok ? classifyFailure(outcome.error) : undefined;
  if (failure) {
    emit("command.failed", {
      command: input.type,
      subsystem: commandSubsystem(input.type),
      duration_ms: Math.round(outcome.durationMs),
      ...failure,
    });
  }
  switch (input.type) {
    case "provider.test":
    case "provider.reauthorize": {
      const result = isObject(outcome.reply?.result) ? outcome.reply.result : undefined;
      const rawProvider =
        stringField(input, "providerId") ?? stringField(input, "id") ?? config.provider;
      const rawModel = stringField(input, "model") ?? config.model;
      const ok = outcome.ok && result?.ok === true;
      const status = typeof result?.status === "number" ? result.status : failure?.http_status;
      const errorKind =
        typeof result?.errorKind === "string"
          ? safeCodeToken(result.errorKind)
          : !ok
            ? (failure?.error_kind ?? "probe_failed")
            : undefined;
      emit("provider.tested", {
        provider: normalizeProvider(rawProvider),
        protocol: config.providers[rawProvider]?.protocol ?? "unknown",
        model: normalizeModel(rawProvider, rawModel),
        ok,
        latency_ms:
          typeof result?.latencyMs === "number"
            ? Math.round(result.latencyMs)
            : Math.round(outcome.durationMs),
        is_draft: Boolean(stringField(input, "draftToken")),
        is_reauthorize: input.type === "provider.reauthorize",
        ...(errorKind ? { error_kind: errorKind } : {}),
        ...(status !== undefined ? { http_status: status } : {}),
      });
      return;
    }
    case "model.probe": {
      const result = isObject(outcome.reply?.result) ? outcome.reply.result : undefined;
      const rawProvider = stringField(input, "provider") ?? config.provider;
      const rawModel = stringField(input, "model") ?? config.model;
      emit("model.probed", {
        provider: normalizeProvider(rawProvider),
        protocol: config.providers[rawProvider]?.protocol ?? "unknown",
        model: normalizeModel(rawProvider, rawModel),
        ok: outcome.ok,
        supports_text: result?.text === true,
        supports_tools: result?.tools === true,
        supports_reasoning: result?.reasoning === true,
        latency_ms:
          typeof result?.latencyMs === "number"
            ? Math.round(result.latencyMs)
            : Math.round(outcome.durationMs),
        ...(failure ? { error_kind: failure.error_kind } : {}),
      });
      return;
    }
    case "provider.discover": {
      const result = isObject(outcome.reply?.result) ? outcome.reply.result : undefined;
      const models = isObject(result?.models) ? Object.keys(result.models).length : 0;
      const warnings = Array.isArray(result?.warnings) ? result.warnings.length : 0;
      emit("provider.discovered", {
        protocol: stringField(input, "protocol") ?? "unknown",
        ok: outcome.ok,
        models_count: models,
        warnings_count: warnings,
        duration_ms: Math.round(outcome.durationMs),
        ...(failure
          ? {
              error_kind: failure.error_kind,
              ...(failure.http_status ? { http_status: failure.http_status } : {}),
            }
          : {}),
      });
      return;
    }
    case "provider.actualize": {
      const result = isObject(outcome.reply?.result) ? outcome.reply.result : undefined;
      const probe = isObject(result?.probe) ? result.probe : undefined;
      const rawProvider = stringField(input, "id") ?? config.provider;
      emit("provider.actualized", {
        provider: normalizeProvider(rawProvider),
        ok: outcome.ok,
        models_count: typeof result?.models === "number" ? result.models : 0,
        added_count: Array.isArray(result?.added) ? result.added.length : 0,
        updated_count: Array.isArray(result?.updated) ? result.updated.length : 0,
        removed_count: Array.isArray(result?.removed) ? result.removed.length : 0,
        warnings_count: Array.isArray(result?.warnings) ? result.warnings.length : 0,
        probe_text: probe?.text === true,
        probe_tools: probe?.tools === true,
        duration_ms: Math.round(outcome.durationMs),
        ...(failure ? { error_kind: failure.error_kind } : {}),
      });
      return;
    }
    case "catalog.sync":
      emit("catalog.synced", {
        ok: outcome.ok,
        duration_ms: Math.round(outcome.durationMs),
        ...(failure ? { error_kind: failure.error_kind } : {}),
      });
      return;
    case "mcp.reconnect": {
      const servers = Array.isArray(outcome.reply?.mcp)
        ? (outcome.reply.mcp as McpServerStatus[])
        : undefined;
      emit("mcp.health", {
        trigger: "reconnect",
        ok: outcome.ok,
        ...summarizeMcpHealth(servers),
        ...(failure ? { error_kind: failure.error_kind } : {}),
      });
      return;
    }
  }
}

function activeToolOf(run: { activeTools: Map<string, { tool: string }> } | undefined): string {
  if (!run) return "none";
  const first = run.activeTools.values().next().value;
  return first ? first.tool : "none";
}

export function trackCommandTelemetry(
  tracker: TelemetryTracker,
  input: Record<string, unknown> & { type: string },
  outcome: CommandOutcome,
  emit: TelemetryEmit,
  config: HarnessConfig,
  now: () => number = () => performance.now(),
): void {
  const sessionId = stringField(input, "sessionId");
  emitCommandHealthDiagnostics(input, outcome, emit, config);
  const failure = !outcome.ok ? classifyFailure(outcome.error) : undefined;
  const failureFields = failure
    ? {
        error_kind: failure.error_kind,
        ...(failure.error_code ? { error_code: failure.error_code } : {}),
        ...(failure.http_status !== undefined ? { http_status: failure.http_status } : {}),
      }
    : {};
  const emitFeature = (event: string, properties: Record<string, unknown>): void => {
    emit(event, { ...properties, ...failureFields });
  };
  switch (input.type) {
    case "stop": {
      const mode = input.mode === "force" ? "force" : "graceful";
      const target = input.target === "worker" ? "worker" : "session";
      const runs = tracker.findRuns(sessionId, target);
      const primary = runs.find((candidate) => candidate.activeTools.size > 0) ?? runs[0];
      for (const run of runs) {
        if (mode === "force") run.forceStopped = true;
        else run.gracefulStopped = true;
      }
      emit("run.stopped", {
        ...(primary ? { run_session_id: primary.runSessionId } : {}),
        mode,
        target,
        elapsed_ms: primary ? Math.max(0, Math.round(now() - primary.startedAt)) : 0,
        turns_so_far: primary?.turns ?? 0,
        active_tool: activeToolOf(primary),
        phase: primary?.phase ?? "unknown",
        provider: primary?.provider ?? normalizeProvider(config.provider),
        model: primary?.model ?? normalizeModel(config.provider, config.model),
      });
      return;
    }
    case "tool.cancel": {
      const callId = stringField(input, "callId");
      const active = callId ? tracker.findTool(callId) : undefined;
      emit("tool.cancelled", {
        tool: active?.tool ?? "unknown",
        elapsed_ms: active ? Math.max(0, Math.round(now() - active.startedAt)) : 0,
        role: active?.run.role ?? "single",
        ok: outcome.ok,
      });
      return;
    }
    case "subagent.stop":
      emitFeature("feature.subagent", { action: "manual_stop", ok: outcome.ok });
      return;
    case "voice.transcribe":
    case "voice.prepare":
    case "voice.cancel": {
      const destination = isObject(input.destination) ? input.destination : undefined;
      const local = isObject(input.local) ? input.local : undefined;
      const engine =
        stringField(destination ?? {}, "engine") ??
        stringField(input, "engine") ??
        config.voice?.engine ??
        "api";
      const language =
        stringField(destination ?? {}, "language") ?? config.voice?.language ?? "auto";
      const audio = stringField(input, "audio");
      const audioKb = audio ? Math.round((audio.length * 0.75) / 1024) : undefined;
      const action =
        input.type === "voice.transcribe"
          ? "transcribe"
          : input.type === "voice.prepare"
            ? "prepare"
            : "cancel";
      emitFeature("feature.voice", {
        action,
        engine,
        language,
        ...(local && stringField(local, "whisperModel")
          ? { model_size: stringField(local, "whisperModel") }
          : {}),
        ...(audioKb !== undefined ? { audio_kb: audioKb } : {}),
        duration_ms: Math.round(outcome.durationMs),
        ok: outcome.ok,
      });
      return;
    }
    case "sessions.edit":
    case "sessions.branch":
    case "sessions.fork":
      emitFeature("feature.branch", {
        action: input.type.slice("sessions.".length),
        ok: outcome.ok,
      });
      return;
    case "twin.train":
    case "twin.teach":
    case "twin.configure":
    case "twin.review":
      emitFeature("feature.twin", {
        action: input.type.slice("twin.".length),
        ok: outcome.ok,
        ...(input.type === "twin.configure" && typeof input.enabled === "boolean"
          ? { enabled: input.enabled }
          : {}),
      });
      return;
    case "checkpoint.restore":
    case "checkpoint.diff": {
      const restore = isObject(outcome.reply?.restore) ? outcome.reply.restore : undefined;
      const restored = Array.isArray(restore?.restored) ? restore.restored.length : 0;
      const removed = Array.isArray(restore?.removed) ? restore.removed.length : 0;
      const skipped = Array.isArray(restore?.skipped) ? restore.skipped.length : 0;
      emitFeature("feature.checkpoint", {
        action: input.type === "checkpoint.restore" ? "restore" : "diff",
        target: stringField(input, "target") ?? "before",
        ok: outcome.ok,
        ...(input.type === "checkpoint.restore"
          ? { files_restored: restored + removed, had_conflicts: skipped > 0 }
          : {}),
      });
      return;
    }
    case "steer":
    case "queue.add":
      emitFeature("feature.queue", {
        mode: input.type === "steer" ? "steer" : "queue",
        has_attachments: Array.isArray(input.attachments) && input.attachments.length > 0,
        has_contexts: Array.isArray(input.contexts) && input.contexts.length > 0,
        ok: outcome.ok,
      });
      return;
    case "skills.reload":
      emitFeature("feature.extension", { subsystem: "skills", action: "reload", ok: outcome.ok });
      return;
    case "mcp.reconnect":
    case "mcp.oauth.start":
      emitFeature("feature.extension", {
        subsystem: "mcp",
        action: input.type === "mcp.reconnect" ? "reconnect" : "oauth_start",
        ok: outcome.ok,
      });
      return;
    case "modules.marketplace": {
      const action = stringField(input, "action");
      if (action === "install" || action === "addSource" || action === "removeSource") {
        emitFeature("feature.extension", { subsystem: "modules", action, ok: outcome.ok });
      }
      return;
    }
    case "modules.change":
      emitFeature("feature.extension", {
        subsystem: "modules",
        action: stringField(input, "operation") ?? "change",
        ok: outcome.ok,
      });
      return;
    case "hooks.test":
      emitFeature("feature.extension", {
        subsystem: "hooks",
        action: stringField(input, "event") ?? "test",
        ok: outcome.ok,
      });
      return;
    case "dictionary.sync":
    case "dictionary.save":
      emitFeature("feature.extension", {
        subsystem: "dictionary",
        action: input.type.slice("dictionary.".length),
        ok: outcome.ok,
      });
      return;
    case "summary.interaction":
      emitFeature("feature.extension", {
        subsystem: "summary",
        action: "interaction",
        ok: outcome.ok,
      });
      return;
    case "context.pull-request":
      emitFeature("feature.extension", {
        subsystem: "context",
        action: "pull_request",
        ok: outcome.ok,
      });
      return;
    case "files.write":
    case "files.search":
      emitFeature("feature.ide", {
        action: input.type === "files.write" ? "file_write" : "workspace_search",
        ok: outcome.ok,
      });
      return;
    case "files.replace":
      if (input.action === "apply")
        emitFeature("feature.ide", { action: "replace_apply", ok: outcome.ok });
      return;
    case "files.git": {
      const action = stringField(input, "action");
      if (action === "stage" || action === "unstage" || action === "commit") {
        emitFeature("feature.ide", { action: `git_${action}`, ok: outcome.ok });
      }
      return;
    }
    case "ide.terminal":
      if (input.action === "create")
        emitFeature("feature.ide", { action: "terminal_create", ok: outcome.ok });
      return;
    case "context.compact":
      if (sessionId) tracker.manualCompactions.add(sessionId);
      emitFeature("feature.session", { action: "compact", ok: outcome.ok });
      return;
    case "sessions.export":
    case "sessions.delete":
      emitFeature("feature.session", {
        action: input.type.slice("sessions.".length),
        ok: outcome.ok,
      });
      return;
    case "access.set":
      emitFeature("feature.session", {
        action: "access_set",
        access_mode: stringField(input, "mode") ?? "unknown",
        ok: outcome.ok,
      });
      return;
    case "model.set": {
      const rawProvider = stringField(input, "provider") ?? config.provider;
      const rawModel = stringField(input, "model") ?? config.model;
      emitFeature("feature.session", {
        action: "model_set",
        scope: sessionId ? "session" : "global",
        provider: normalizeProvider(rawProvider),
        model: normalizeModel(rawProvider, rawModel),
        ...(stringField(input, "reasoning") ? { reasoning: stringField(input, "reasoning") } : {}),
        ok: outcome.ok,
      });
      return;
    }
    case "trust.accept":
    case "trust.reject":
      emitFeature("feature.session", {
        action: input.type === "trust.accept" ? "trust_accept" : "trust_reject",
        ok: outcome.ok,
      });
      return;
    case "settings.save":
      emitFeature("feature.session", { action: "settings_save", ok: outcome.ok });
      return;
  }
}
