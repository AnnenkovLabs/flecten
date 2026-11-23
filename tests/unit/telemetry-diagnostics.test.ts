import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppInfo } from "../../src/app/service-types";
import { HarnessConfigSchema } from "../../src/config/schema";
import { LimitError, MissingKeyError } from "../../src/errors";
import { TelemetryRuntime } from "../../src/observability/telemetry";
import { trackCommandTelemetry } from "../../src/observability/telemetry-commands";
import { TelemetryTracker } from "../../src/observability/telemetry-tracker";
import { TransportError } from "../../src/providers/transport";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("Telemetry engineering diagnostics", () => {
  test("tracks response anomalies, hooks, worker acceptance, resets, and run.error root causes", () => {
    let nowMs = 1_000;
    const tracker = new TelemetryTracker(() => nowMs);
    const config = HarnessConfigSchema.parse({ provider: "openai", model: "gpt-5.1" });
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    const emit = (event: string, properties: Record<string, unknown>) =>
      captured.push({ event, properties });

    tracker.handleEvent(
      {
        type: "session.started",
        sessionId: "s_diag",
        provider: "openai",
        model: "gpt-5.1",
        role: "worker",
        prompt: "SECRET_PROMPT",
      },
      emit,
      config,
    );
    tracker.handleEvent({ type: "turn.started", sessionId: "s_diag", turn: 2 }, emit, config);
    tracker.handleEvent({ type: "message.delta", sessionId: "s_diag", text: "hi" }, emit, config);
    tracker.handleEvent(
      {
        type: "provider.response",
        sessionId: "s_diag",
        response: {
          protocol: "openai-responses",
          status: "complete",
          outcome: "complete",
          frames: 4,
          invalidFrames: 0,
          unsupportedFrames: 0,
          textBytes: 0,
          reasoningBytes: 0,
          toolCalls: 0,
          usage: "reported",
          terminal: true,
          durationMs: 310,
        },
      },
      emit,
      config,
    );
    tracker.handleEvent(
      {
        type: "provider.retry",
        sessionId: "s_diag",
        kind: "rate_limit",
        attempt: 1,
        delayMs: 1000,
        until: 2000,
        reason: "429",
      },
      emit,
      config,
    );
    tracker.handleEvent(
      { type: "message.reset", sessionId: "s_diag", reason: "stream_retry" },
      emit,
      config,
    );
    tracker.handleEvent(
      { type: "translation.failed", sessionId: "s_diag", message: "bad" },
      emit,
      config,
    );
    tracker.handleEvent(
      {
        type: "hook.finished",
        sessionId: "s_diag",
        hook: {
          event: "preToolUse",
          index: 0,
          source: { type: "project" },
          ok: false,
          blocked: true,
          durationMs: 12,
          exitCode: 2,
          timedOut: false,
        },
      },
      emit,
      config,
    );
    const baseAcc = {
      taskId: "t1",
      revision: 1,
      legacy: false,
      phase: "unconfirmed" as const,
      directions: ["fix it"],
      assignment: {
        objective: "secret objective",
        userConstraints: [],
        expectedOutputs: ["patch"],
        acceptanceCriteria: [
          { id: "c1", description: "passes", evidenceRequirement: "tool_result" as const },
          { id: "c2", description: "clean", evidenceRequirement: "model_assertion" as const },
        ],
      },
      criteria: [
        {
          id: "c1",
          status: "met" as const,
          evidence: {
            kind: "tool_result" as const,
            callId: "x",
            tool: "terminal",
            output: "ok",
            statement: "ok",
          },
        },
        { id: "c2", status: "blocked" as const, reason: "missing secret" },
      ],
    };
    tracker.handleEvent(
      { type: "worker.acceptance", sessionId: "s_diag", acceptance: baseAcc },
      emit,
      config,
    );
    tracker.handleEvent(
      { type: "worker.acceptance", sessionId: "s_diag", acceptance: baseAcc },
      emit,
      config,
    );
    tracker.handleEvent(
      {
        type: "job.finished",
        sessionId: "s_diag",
        notify: true,
        job: {
          id: "j1",
          command: "bun test /secret",
          cwd: "/secret",
          status: "exited",
          pid: 123,
          startedAt: 1000,
          finishedAt: 1045,
          durationMs: 45,
          exitCode: 1,
          signal: null,
          timedOut: false,
          logBytes: 128,
          error: null,
        },
      },
      emit,
      config,
    );
    tracker.handleEvent(
      {
        type: "tool.finished",
        sessionId: "s_diag",
        call: { id: "c_retry", name: "read", args: {} },
        result: { ok: true, output: "ok", attempts: 2, repaired: true, durationMs: 25 },
      },
      emit,
      config,
    );
    tracker.handleEvent(
      {
        type: "error",
        sessionId: "s_diag",
        code: "provider_failed",
        message: "raw https://api.secret.test token sk-secret999",
        reason: "transport_http",
        status: 502,
        providerCode: "bad_gateway",
      },
      emit,
      config,
    );
    nowMs = 2_000;
    tracker.handleEvent(
      {
        type: "session.finished",
        sessionId: "s_diag",
        result: {
          sessionId: "s_diag",
          pass: false,
          stopReason: "error",
          summary: "failed",
          turns: 2,
          usage: { input: 100, output: 10, cached: 50 },
        },
      },
      emit,
      config,
    );

    expect(JSON.stringify(captured)).not.toContain("sk-secret999");
    expect(JSON.stringify(captured)).not.toContain("secret objective");
    expect(captured.find((e) => e.event === "provider.response.failed")?.properties).toMatchObject({
      is_empty_response: true,
    });
    expect(captured.find((e) => e.event === "turn.message_reset")?.properties).toMatchObject({
      reason: "stream_retry",
      turn: 2,
    });
    expect(captured.find((e) => e.event === "hook.failed")?.properties).toMatchObject({
      hook_event: "preToolUse",
      blocked: true,
      exit_code: 2,
    });
    expect(captured.filter((e) => e.event === "worker.acceptance")).toHaveLength(1);
    expect(captured.find((e) => e.event === "worker.acceptance")?.properties).toMatchObject({
      phase: "unconfirmed",
      criteria_total: 2,
      criteria_met: 1,
      criteria_blocked: 1,
    });
    expect(captured.find((e) => e.event === "background_job.finished")?.properties).toMatchObject({
      ok: false,
      exit_code: 1,
    });
    expect(captured.find((e) => e.event === "run.error")?.properties).toMatchObject({
      reason: "transport_http",
      http_status: 502,
      provider_code: "bad_gateway",
      phase: "retry",
      turns_so_far: 2,
      retries_so_far: 1,
      had_first_token: true,
      last_retry_kind: "rate_limit",
      last_response_outcome: "complete",
    });
    expect(captured.find((e) => e.event === "run.finished")?.properties).toMatchObject({
      provider_empty_responses: 1,
      message_resets_count: 1,
      hooks_executed: 1,
      hooks_failed: 1,
      hooks_blocked: 1,
      translation_failures_count: 1,
      tool_calls_repaired: 1,
      tool_calls_retried: 1,
    });
  });

  test("tracks universal command.failed, setup health commands, and startup subsystem counts", async () => {
    const tracker = new TelemetryTracker();
    const config = HarnessConfigSchema.parse({ provider: "openai", model: "gpt-5.1" });
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    const emit = (event: string, properties: Record<string, unknown>) =>
      captured.push({ event, properties });

    trackCommandTelemetry(
      tracker,
      { type: "voice.transcribe", id: "1", audio: "AAAA" },
      { ok: false, durationMs: 120, error: new MissingKeyError("openai", "OPENAI_API_KEY") },
      emit,
      config,
    );
    trackCommandTelemetry(
      tracker,
      { type: "provider.test", providerId: "openai", model: "gpt-5.1" },
      {
        ok: true,
        durationMs: 90,
        reply: { result: { ok: false, latencyMs: 85, errorKind: "transport_http", status: 401 } },
      },
      emit,
      config,
    );
    trackCommandTelemetry(
      tracker,
      { type: "model.probe", provider: "openai", model: "gpt-5.1" },
      {
        ok: true,
        durationMs: 250,
        reply: { result: { text: true, tools: false, reasoning: true, latencyMs: 240 } },
      },
      emit,
      config,
    );
    trackCommandTelemetry(
      tracker,
      { type: "mcp.reconnect" },
      {
        ok: true,
        durationMs: 40,
        reply: {
          mcp: [
            { id: "gh", state: "ready", tools: 6 },
            { id: "db", state: "failed", tools: 0, error: "secret" },
          ],
        },
      },
      emit,
      config,
    );
    trackCommandTelemetry(
      tracker,
      { type: "provider.discover", protocol: "openai-chat" },
      {
        ok: false,
        durationMs: 300,
        error: new TransportError("bad", { reason: "http", status: 503 }),
      },
      emit,
      config,
    );

    expect(
      captured.find(
        (e) => e.event === "command.failed" && e.properties.command === "voice.transcribe",
      )?.properties,
    ).toMatchObject({
      subsystem: "voice",
      error_kind: "missing_api_key",
    });
    expect(captured.find((e) => e.event === "provider.tested")?.properties).toMatchObject({
      ok: false,
      error_kind: "transport_http",
      http_status: 401,
    });
    expect(captured.find((e) => e.event === "model.probed")?.properties).toMatchObject({
      ok: true,
      supports_text: true,
      supports_tools: false,
      supports_reasoning: true,
    });
    expect(captured.find((e) => e.event === "mcp.health")?.properties).toMatchObject({
      trigger: "reconnect",
      servers_total: 2,
      mcp_ready_count: 1,
      mcp_failed_count: 1,
      mcp_tools_count: 6,
    });
    expect(captured.find((e) => e.event === "provider.discovered")?.properties).toMatchObject({
      ok: false,
      error_kind: "transport_http",
      http_status: 503,
    });

    const cwd = await makeTempDir("flecten-startup-diag-");
    const shipped: Array<{ event: string; properties: Record<string, unknown> }> = [];
    const runtime = new TelemetryRuntime({
      cwd,
      getConfig: () => config,
      getInfo: () =>
        ({
          cwd,
          project: "p",
          branch: "main",
          user: "u",
          provider: "openai",
          model: "gpt-5.1",
          accessMode: "auto",
          contextWindow: 128_000,
          maxOutputTokens: 4096,
          update: { channel: "beta", autoCheck: false, checkOnStartup: false },
          providers: [],
          secretBackend: "keychain",
          configError: "invalid provider field",
          trustRequired: false,
          trustAccepted: true,
          trustState: "trusted",
          skills: {
            count: 2,
            names: ["a", "b"],
            diagnostics: [
              { level: "error", source: "s", message: "bad" },
              { level: "warning", source: "s", message: "warn" },
            ],
          },
          mcp: {
            tools: 4,
            servers: [
              { id: "m1", state: "ready", tools: 4 },
              { id: "m2", state: "degraded", tools: 0 },
            ],
          },
          sandbox: {
            enabled: true,
            kind: "bubblewrap",
            available: false,
            reason: "no bwrap",
            warning: "warn",
          },
          memory: { records: 3 },
          system: { version: "1", hash: "h", tokens: 100, parts: [] },
          shellCheckpoints: { state: "ready" },
        }) as unknown as AppInfo,
      env: { FLECTEN_POSTHOG_API_KEY: "phc_test", FLECTEN_TELEMETRY: "1" },
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          batch?: Array<{ event: string; properties: Record<string, unknown> }>;
        };
        if (body.batch) shipped.push(...body.batch);
        return Response.json({ status: 1 });
      }) as unknown as typeof fetch,
      flushIntervalMs: 0,
    });
    runtime.recordStartup({
      startupMs: 50,
      migrationNeeded: false,
      interruptedRunsCount: 0,
      resumedRunsCount: 0,
    });
    runtime.recordMigration({
      ok: false,
      durationMs: 12,
      error: new LimitError("limit", "rate", 10),
    });
    await runtime.shutdown();
    expect(shipped.find((e) => e.event === "app.started")?.properties).toMatchObject({
      has_config_error: true,
      secret_backend: "keychain",
      sandbox_available: false,
      sandbox_has_warning: true,
      skill_errors_count: 1,
      skill_warnings_count: 1,
      mcp_ready_count: 1,
      mcp_degraded_count: 1,
      mcp_failed_count: 0,
      mcp_tools_count: 4,
    });
    expect(shipped.find((e) => e.event === "storage.migration.failed")?.properties).toMatchObject({
      duration_ms: 12,
      error_kind: "provider_limit",
      limit_kind: "rate",
    });
  });
});
