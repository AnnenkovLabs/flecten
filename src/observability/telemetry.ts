import { release } from "node:os";
import packageJson from "../../package.json";
import { activeAccessMode } from "../../shared/access-mode";
import { productEnv } from "../../shared/environment.cjs";
import { type TelemetryStatus, TelemetryTrackCommandSchema } from "../../shared/telemetry";
import type { AppInfo } from "../app/service-types";
import type { HarnessConfig } from "../config/schema";
import type { Event } from "../core/types";
import { PostHogClient } from "./posthog-client";
import { type CommandOutcome, trackCommandTelemetry } from "./telemetry-commands";
import { BUILD_COMMIT, loadOrCreateDistinctId, resolvePostHogSettings } from "./telemetry-config";
import { summarizeMcpHealth } from "./telemetry-diagnostics";
import { classifyFailure } from "./telemetry-errors";
import {
  classifyError,
  normalizeModel,
  normalizeProvider,
  sanitizeProperties,
} from "./telemetry-sanitize";
import { TelemetryTracker } from "./telemetry-tracker";

export interface TelemetryRuntimeOptions {
  cwd: string;
  getConfig: () => HarnessConfig;
  getInfo: () => AppInfo | undefined;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  flushIntervalMs?: number;
  now?: () => number;
}

export interface StartupMetrics {
  startupMs: number;
  electronStartupMs?: number;
  migrationNeeded: boolean;
  interruptedRunsCount: number;
  resumedRunsCount: number;
}

export class TelemetryRuntime {
  readonly #cwd: string;
  readonly #getConfig: () => HarnessConfig;
  readonly #getInfo: () => AppInfo | undefined;
  readonly #env: Record<string, string | undefined>;
  readonly #now: () => number;
  readonly #startedAt: number;
  readonly #appSessionId = crypto.randomUUID();
  readonly #tracker: TelemetryTracker;
  readonly #client: PostHogClient;
  #distinctId: string | undefined;
  #uiLocale = "en";

  constructor(options: TelemetryRuntimeOptions) {
    this.#cwd = options.cwd;
    this.#getConfig = options.getConfig;
    this.#getInfo = options.getInfo;
    this.#env = options.env ?? process.env;
    this.#now = options.now ?? (() => performance.now());
    this.#startedAt = this.#now();
    this.#tracker = new TelemetryTracker(this.#now);
    this.#client = new PostHogClient({
      getTarget: () => {
        const settings = resolvePostHogSettings(this.#getConfig(), this.#env);
        if (!settings.active || !settings.batchUrl) return null;
        return { apiKey: settings.apiKey, batchUrl: settings.batchUrl };
      },
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.flushIntervalMs !== undefined
        ? { flushIntervalMs: options.flushIntervalMs }
        : {}),
    });
  }

  async init(): Promise<void> {
    this.#distinctId ??= await loadOrCreateDistinctId(this.#cwd, this.#env);
  }

  status(): TelemetryStatus {
    const settings = resolvePostHogSettings(this.#getConfig(), this.#env);
    return {
      enabled: settings.enabled,
      active: settings.active,
      disabledByEnv: settings.disabledByEnv,
      configured: settings.configured,
      host: settings.host,
      ...(this.#distinctId ? { distinctId: this.#distinctId } : {}),
    };
  }

  capture(event: string, properties: Record<string, unknown> = {}): void {
    const settings = resolvePostHogSettings(this.#getConfig(), this.#env);
    if (!settings.active) return;
    const distinctId = this.#distinctId ?? `anon_${this.#appSessionId}`;
    this.#client.enqueue({
      event,
      distinct_id: distinctId,
      timestamp: new Date().toISOString(),
      uuid: crypto.randomUUID(),
      properties: sanitizeProperties({
        ...this.#superProperties(),
        ...properties,
        $lib: "flecten",
        $lib_version: packageJson.version,
        $process_person_profile: false,
      }),
    });
  }

  recordStartup(metrics: StartupMetrics): void {
    const config = this.#getConfig();
    const info = this.#getInfo();
    const hookCount = Object.values(config.hooks ?? {}).reduce(
      (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
      0,
    );
    const skillErrorsCount =
      info?.skills.diagnostics.filter((item) => item.level === "error").length ?? 0;
    const skillWarningsCount =
      info?.skills.diagnostics.filter((item) => item.level === "warning").length ?? 0;
    const mcpSummary = summarizeMcpHealth(info?.mcp.servers);
    this.capture("app.started", {
      startup_ms: Math.round(metrics.startupMs),
      ...(metrics.electronStartupMs !== undefined
        ? { electron_startup_ms: Math.round(metrics.electronStartupMs) }
        : {}),
      migration_needed: metrics.migrationNeeded,
      trust_state: info?.trustState ?? "unknown",
      has_config_error: Boolean(info?.configError),
      secret_backend: info?.secretBackend ?? "unknown",
      sandbox_available: info?.sandbox.available ?? false,
      sandbox_has_warning: Boolean(info?.sandbox.warning),
      provider_count: Object.keys(config.providers).length,
      active_provider: normalizeProvider(config.provider),
      active_protocol: config.providers[config.provider]?.protocol ?? "unknown",
      active_model: normalizeModel(config.provider, config.model),
      mcp_server_count: Object.keys(config.mcp?.servers ?? {}).length,
      ...mcpSummary,
      skill_count: info?.skills.count ?? 0,
      skill_errors_count: skillErrorsCount,
      skill_warnings_count: skillWarningsCount,
      hook_count: hookCount,
      memory_records: info?.memory.records ?? 0,
      translation_enabled: config.translation?.enabled === true,
      voice_engine: config.voice?.engine ?? "api",
      shell_checkpoints_state: info?.shellCheckpoints.state ?? "off",
      interrupted_runs_count: metrics.interruptedRunsCount,
      resumed_runs_count: metrics.resumedRunsCount,
    });
  }

  recordMigration(result: { ok: boolean; durationMs: number; error?: unknown }): void {
    this.capture(result.ok ? "storage.migration.completed" : "storage.migration.failed", {
      duration_ms: Math.round(result.durationMs),
      ...(!result.ok && result.error !== undefined ? classifyFailure(result.error) : {}),
    });
  }

  recordEvent(event: Event): void {
    this.#tracker.handleEvent(
      event,
      (name, properties) => this.capture(name, properties),
      this.#getConfig(),
    );
  }

  recordCommand(input: Record<string, unknown> & { type: string }, outcome: CommandOutcome): void {
    if (input.type === "settings.save" && !(this.#getConfig().telemetry?.enabled ?? true)) {
      this.#client.clear();
    }
    trackCommandTelemetry(
      this.#tracker,
      input,
      outcome,
      (name, properties) => this.capture(name, properties),
      this.#getConfig(),
      this.#now,
    );
  }

  trackClient(raw: unknown): void {
    const parsed = TelemetryTrackCommandSchema.parse(raw);
    if (parsed.event === "ui.locale") {
      this.#uiLocale = parsed.properties.locale;
      return;
    }
    this.capture(parsed.event, parsed.properties);
  }

  async recordCrash(error: unknown): Promise<void> {
    this.capture("app.crashed", {
      source: "sidecar",
      ...classifyError(error),
      ...classifyFailure(error),
    });
    await this.#client.flush({ timeoutMs: 2_000, bypassBackoff: true }).catch(() => undefined);
  }

  async sendManual(): Promise<void> {
    const settings = resolvePostHogSettings(this.#getConfig(), this.#env);
    if (!settings.enabled) throw new Error("Telemetry is disabled in settings");
    if (settings.disabledByEnv) throw new Error("Telemetry is disabled by environment variable");
    if (settings.urlError) throw new Error(settings.urlError);
    if (!settings.apiKey) throw new Error("PostHog API key is not configured");
    this.capture("telemetry.ping", { manual: true });
    await this.#client.flush({ timeoutMs: 5_000, throwOnError: true, bypassBackoff: true });
  }

  async shutdown(): Promise<void> {
    this.capture("app.shutdown", {
      uptime_ms: Math.max(0, Math.round(this.#now() - this.#startedAt)),
      runs_started: this.#tracker.totals.runsStarted,
      runs_completed: this.#tracker.totals.runsCompleted,
      tool_calls_total: this.#tracker.totals.toolCalls,
      errors_total: this.#tracker.totals.errors,
    });
    await this.#client.shutdown();
  }

  #superProperties(): Record<string, unknown> {
    const config = this.#getConfig();
    const info = this.#getInfo();
    return {
      app_version: packageJson.version,
      app_commit: BUILD_COMMIT || productEnv("COMMIT", this.#env) || "unknown",
      os: process.platform,
      os_release: release(),
      arch: process.arch,
      bun_version: typeof Bun !== "undefined" ? Bun.version : "unknown",
      is_packaged: productEnv("PACKAGED", this.#env) === "1",
      projectless: productEnv("PROJECTLESS", this.#env) === "1",
      ui_locale: this.#uiLocale,
      access_mode: info?.accessMode ?? activeAccessMode(config),
      sandbox_enabled: info?.sandbox.enabled ?? config.sandbox?.enabled ?? false,
      sandbox_kind: info?.sandbox.kind ?? "none",
      conversation_mode: config.conversation?.enabled === false ? "single" : "talker_worker",
      update_channel: config.update?.channel ?? "beta",
      app_session_id: this.#appSessionId,
    };
  }
}
