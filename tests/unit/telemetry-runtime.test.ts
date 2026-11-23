import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessConfigSchema } from "../../src/config/schema";
import { TelemetryRuntime } from "../../src/observability/telemetry";
import { trackCommandTelemetry } from "../../src/observability/telemetry-commands";
import { TelemetryTracker } from "../../src/observability/telemetry-tracker";
import { installErrorTelemetry, trackScreen } from "../../ui/src/lib/telemetry";

const require = createRequire(import.meta.url);
const { createShellTelemetry } = require("../../shell/telemetry.mjs") as {
  createShellTelemetry(options: { sendToAgent: (command: unknown) => void; packaged: boolean }): {
    env(): Record<string, string>;
    onStatus(message: { update?: { channel?: string } }): void;
    onAgentExit(code: number | null, signal: string | null): void;
    onRendererGone(reason: string): void;
    onShellError(kind: string, extra?: Record<string, unknown>): void;
    attachWindow(win: unknown): void;
    onUpdaterStatus(status: {
      state: string;
      enabled: boolean;
      version?: string;
      message?: string;
    }): void;
    onDeepLink(): void;
  };
};

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("TelemetryTracker and TelemetryRuntime end-to-end", () => {
  test("tracks run, cache ratio, tool failures, force stop context, and features without PII", async () => {
    let nowMs = 1_000;
    const tracker = new TelemetryTracker(() => nowMs);
    const config = HarnessConfigSchema.parse({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = [];
    const emit = (event: string, properties: Record<string, unknown>) => {
      captured.push({ event, properties });
    };

    tracker.handleEvent(
      {
        type: "session.started",
        sessionId: "s_1",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        role: "talker",
        prompt: "TOP_SECRET_USER_PROMPT_DO_NOT_LEAK",
        reasoning: "high",
      },
      emit,
      config,
    );
    nowMs = 1_250;
    tracker.handleEvent({ type: "turn.started", sessionId: "s_1", turn: 1 }, emit, config);
    tracker.handleEvent(
      { type: "message.delta", sessionId: "s_1", text: "secret token" },
      emit,
      config,
    );
    tracker.handleEvent(
      {
        type: "tool.started",
        sessionId: "s_1",
        call: { id: "c1", name: "terminal", args: { command: "rm -rf /secret/path" } },
      },
      emit,
      config,
    );
    nowMs = 2_000;
    trackCommandTelemetry(
      tracker,
      { type: "stop", sessionId: "s_1", mode: "force" },
      { ok: true, durationMs: 3 },
      emit,
      config,
      () => nowMs,
    );
    tracker.handleEvent(
      {
        type: "tool.finished",
        sessionId: "s_1",
        call: { id: "c1", name: "terminal", args: { command: "echo hi" } },
        result: {
          ok: false,
          output: "SECRET_OUTPUT",
          error: "ConPTY failed",
          durationMs: 750,
          repaired: true,
          data: { exitCode: 1 },
        },
      },
      emit,
      config,
    );
    tracker.handleEvent(
      {
        type: "context.summary.failed",
        sessionId: "s_1",
        stage: "provider",
        reason: "timeout",
      },
      emit,
      config,
    );
    nowMs = 3_000;
    tracker.handleEvent(
      {
        type: "session.finished",
        sessionId: "s_1",
        result: {
          sessionId: "s_1",
          pass: false,
          stopReason: "stopped",
          summary: "SECRET_SUMMARY",
          turns: 1,
          usage: { input: 1000, output: 200, cached: 800 },
        },
      },
      emit,
      config,
    );

    trackCommandTelemetry(
      tracker,
      {
        type: "voice.transcribe",
        id: "11111111-1111-4111-8111-111111111111",
        audio: "AAAA",
        mimeType: "audio/wav",
        destination: {
          engine: "faster-whisper",
          providerId: "faster-whisper",
          model: "small",
          language: "ru",
        },
      },
      { ok: true, durationMs: 420 },
      emit,
      config,
    );
    trackCommandTelemetry(
      tracker,
      { type: "ide.terminal", action: "write", id: "t1", data: "secret" },
      { ok: true, durationMs: 1 },
      emit,
      config,
    );
    trackCommandTelemetry(
      tracker,
      { type: "ide.terminal", action: "create" },
      { ok: true, durationMs: 10 },
      emit,
      config,
    );

    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain("TOP_SECRET_USER_PROMPT_DO_NOT_LEAK");
    expect(serialized).not.toContain("/secret/path");
    expect(serialized).not.toContain("SECRET_OUTPUT");
    expect(serialized).not.toContain("SECRET_SUMMARY");

    const stopped = captured.find((item) => item.event === "run.stopped");
    expect(stopped?.properties).toMatchObject({
      mode: "force",
      active_tool: "terminal",
      turns_so_far: 1,
      elapsed_ms: 1000,
    });

    const toolFail = captured.find((item) => item.event === "tool.failed");
    expect(toolFail?.properties).toMatchObject({
      tool: "terminal",
      error_kind: "exit_nonzero",
      duration_ms: 750,
    });

    const finished = captured.find((item) => item.event === "run.finished");
    expect(finished?.properties).toMatchObject({
      cache_hit_ratio: 0.8,
      ttft_ms: 250,
      total_tokens: 1200,
      compaction_failures_count: 1,
      tool_calls_failed: 1,
      was_force_stopped: true,
    });

    const ideEvents = captured.filter((item) => item.event === "feature.ide");
    expect(ideEvents).toHaveLength(1);
    expect(ideEvents[0]?.properties.action).toBe("terminal_create");

    const voiceEvent = captured.find((item) => item.event === "feature.voice");
    expect(voiceEvent?.properties).toMatchObject({
      action: "transcribe",
      engine: "faster-whisper",
      language: "ru",
      ok: true,
    });
  });

  test("TelemetryRuntime ships batches to local PostHog endpoint and stops on opt-out", async () => {
    const batches: Array<{
      batch: Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }>;
    }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        batches.push((await request.json()) as (typeof batches)[number]);
        return Response.json({ status: 1 });
      },
    });
    const cwd = await makeTempDir("flecten-telemetry-e2e-");
    const profile = await makeTempDir("flecten-telemetry-prof-");
    let config = HarnessConfigSchema.parse({
      telemetry: { enabled: true, endpoint: server.url.toString() },
    });
    const runtime = new TelemetryRuntime({
      cwd,
      getConfig: () => config,
      getInfo: () => undefined,
      env: {
        FLECTEN_PROFILE: profile,
        FLECTEN_POSTHOG_API_KEY: "phc_e2e_test",
        FLECTEN_TELEMETRY: "1",
      },
      flushIntervalMs: 0,
    });

    try {
      await runtime.init();
      runtime.recordStartup({
        startupMs: 88,
        electronStartupMs: 240,
        migrationNeeded: false,
        interruptedRunsCount: 0,
        resumedRunsCount: 0,
      });
      runtime.trackClient({
        type: "telemetry.track",
        event: "ui.locale",
        properties: { locale: "ru" },
      });
      runtime.trackClient({
        type: "telemetry.track",
        event: "ui.screen_viewed",
        properties: {
          screen: "agent",
          surface: "thread",
          layout: "focus",
          viewport_bucket: "standard",
        },
      });
      await runtime.sendManual();

      const events = batches.flatMap((batch) => batch.batch);
      expect(events.map((item) => item.event)).toEqual([
        "app.started",
        "ui.screen_viewed",
        "telemetry.ping",
      ]);
      expect(events[0]?.properties.os).toBe(process.platform);
      expect(events[0]?.properties.$process_person_profile).toBe(false);
      expect(events[1]?.properties.ui_locale).toBe("ru");
      expect(events[0]?.distinct_id.startsWith("anon_")).toBe(true);

      config = HarnessConfigSchema.parse({
        telemetry: { enabled: false, endpoint: server.url.toString() },
      });
      runtime.recordCommand({ type: "settings.save" }, { ok: true, durationMs: 5 });
      runtime.capture("should.not.send", {});
      await expect(runtime.sendManual()).rejects.toThrow("Telemetry is disabled in settings");
      await runtime.shutdown();
      expect(batches.flatMap((batch) => batch.batch)).toHaveLength(3);
    } finally {
      server.stop(true);
    }
  });
});

describe("shell telemetry wrapper", () => {
  test("queues crashes before status and classifies updater errors without raw messages", () => {
    const sent: unknown[] = [];
    const shell = createShellTelemetry({
      sendToAgent: (command: unknown) => sent.push(command),
      packaged: true,
    });
    expect(shell.env().FLECTEN_PACKAGED).toBe("1");
    expect(Number(shell.env().FLECTEN_LAUNCH_TS)).toBeGreaterThan(0);

    shell.onAgentExit(0, null);
    shell.onAgentExit(1, null);
    shell.onRendererGone("oom");
    shell.onDeepLink();
    expect(sent).toHaveLength(0);

    shell.onStatus({ update: { channel: "stable" } });
    expect(sent).toHaveLength(3);
    expect(sent[0]).toEqual({
      type: "telemetry.track",
      event: "app.crashed",
      properties: { source: "sidecar", restart_count: 1, exit_code: 1 },
    });
    expect(sent[1]).toEqual({
      type: "telemetry.track",
      event: "app.crashed",
      properties: { source: "renderer", error_name: "oom" },
    });
    expect(sent[2]).toEqual({
      type: "telemetry.track",
      event: "app.deep_link",
      properties: { kind: "session" },
    });

    shell.onUpdaterStatus({
      state: "error",
      enabled: true,
      message: "Ed25519 signature mismatch for https://secret-internal.host/beta.yml",
    });
    expect(sent[3]).toEqual({
      type: "telemetry.track",
      event: "updater.state",
      properties: { state: "error", channel: "stable", error_kind: "signature" },
    });
  });

  test("shell attachWindow and ui telemetry attach screen/surface context on errors", () => {
    const sent: Array<{ type: string; event: string; properties: Record<string, unknown> }> = [];
    const shell = createShellTelemetry({
      sendToAgent: (command: unknown) => sent.push(command as (typeof sent)[number]),
      packaged: false,
    });
    shell.onStatus({ update: { channel: "beta" } });
    const winListeners = new Map<string, (...args: unknown[]) => void>();
    const wcListeners = new Map<string, (...args: unknown[]) => void>();
    shell.attachWindow({
      on: (ev: string, fn: (...args: unknown[]) => void) => winListeners.set(ev, fn),
      webContents: {
        on: (ev: string, fn: (...args: unknown[]) => void) => wcListeners.set(ev, fn),
      },
    });
    wcListeners.get("did-fail-load")?.({}, -105, "ERR_NAME_NOT_RESOLVED", "flecten://app", true);
    winListeners.get("unresponsive")?.();
    winListeners.get("responsive")?.();
    shell.onShellError("ipc_validation_failed");
    expect(sent.map((item) => item.properties.kind)).toEqual([
      "renderer_load_failed",
      "renderer_unresponsive",
      "renderer_responsive",
      "ipc_validation_failed",
    ]);

    const uiSent: unknown[] = [];
    const listeners = new Map<string, (event: unknown) => void>();
    const prevWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      desktop: { agent: { send: (cmd: unknown) => uiSent.push(cmd), onEvent: () => () => {} } },
      addEventListener: (ev: string, fn: (event: unknown) => void) => listeners.set(ev, fn),
      removeEventListener: (ev: string) => listeners.delete(ev),
    };
    try {
      const cleanup = installErrorTelemetry();
      trackScreen("agent", "terminal", "split", 1480);
      listeners.get("error")?.({ error: new TypeError("boom") });
      cleanup();
      expect(
        uiSent.find((item: unknown) => (item as { event?: string }).event === "ui.error"),
      ).toEqual({
        type: "telemetry.track",
        event: "ui.error",
        properties: {
          source: "window_error",
          error_name: "TypeError",
          screen: "agent",
          surface: "terminal",
          has_stack: true,
        },
      });
    } finally {
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prevWindow;
    }
  });
});
