import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZodError, z } from "zod";
import { TelemetryTrackCommandSchema } from "../../shared/telemetry";
import { HarnessConfigSchema } from "../../src/config/schema";
import { HarnessError, LimitError, MissingKeyError, ProjectLockedError } from "../../src/errors";
import { PostHogClient } from "../../src/observability/posthog-client";
import {
  isTelemetryDisabledByEnv,
  loadOrCreateDistinctId,
  resolvePostHogBatchUrl,
  resolvePostHogSettings,
} from "../../src/observability/telemetry-config";
import {
  classifyFailure,
  classifyToolFailureDetail,
} from "../../src/observability/telemetry-errors";
import {
  classifyError,
  classifyToolFailure,
  normalizeModel,
  normalizeProvider,
  normalizeToolName,
  sanitizeProperties,
} from "../../src/observability/telemetry-sanitize";
import { ProviderResponseError } from "../../src/providers/response";
import { TransportError } from "../../src/providers/transport";
import { ToolRegistry } from "../../src/tools/registry";
import { ToolFailure } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("telemetry config and privacy kill-switches", () => {
  test("honors DO_NOT_TRACK, FLECTEN_TELEMETRY, and automated test env defaults", () => {
    expect(isTelemetryDisabledByEnv({})).toBe(false);
    expect(isTelemetryDisabledByEnv({ DO_NOT_TRACK: "1" })).toBe(true);
    expect(isTelemetryDisabledByEnv({ FLECTEN_TELEMETRY: "0" })).toBe(true);
    expect(isTelemetryDisabledByEnv({ LIQUID_TELEMETRY: "false" })).toBe(true);
    expect(isTelemetryDisabledByEnv({ FLECTEN_HEADLESS: "1" })).toBe(true);
    expect(isTelemetryDisabledByEnv({ FLECTEN_SMOKE: "1" })).toBe(true);
    expect(isTelemetryDisabledByEnv({ CI: "true" })).toBe(true);
    expect(isTelemetryDisabledByEnv({ NODE_ENV: "test" })).toBe(true);
    expect(isTelemetryDisabledByEnv({ CI: "true", FLECTEN_TELEMETRY: "1" })).toBe(false);
    expect(isTelemetryDisabledByEnv({ DO_NOT_TRACK: "1", FLECTEN_TELEMETRY: "1" })).toBe(true);
  });

  test("validates PostHog hosts and builds /batch/ URLs safely", () => {
    expect(resolvePostHogBatchUrl("https://eu.i.posthog.com")).toEqual({
      ok: true,
      host: "https://eu.i.posthog.com",
      batchUrl: "https://eu.i.posthog.com/batch/",
    });
    expect(resolvePostHogBatchUrl("http://127.0.0.1:8123/")).toEqual({
      ok: true,
      host: "http://127.0.0.1:8123",
      batchUrl: "http://127.0.0.1:8123/batch/",
    });
    expect(resolvePostHogBatchUrl("http://example.com").ok).toBe(false);
    expect(resolvePostHogBatchUrl("https://user:pass@eu.i.posthog.com").ok).toBe(false);
    expect(resolvePostHogBatchUrl("not a url").ok).toBe(false);
  });

  test("resolves opt-out default and runtime overrides", () => {
    const config = HarnessConfigSchema.parse({});
    expect(config.telemetry?.enabled).toBe(true);
    const active = resolvePostHogSettings(config, {
      FLECTEN_POSTHOG_API_KEY: "phc_test_key",
      FLECTEN_TELEMETRY: "1",
    });
    expect(active.active).toBe(true);
    expect(active.host).toBe("https://eu.i.posthog.com");
    expect(active.batchUrl).toBe("https://eu.i.posthog.com/batch/");

    const disabled = resolvePostHogSettings(config, {
      FLECTEN_POSTHOG_API_KEY: "phc_test_key",
      DO_NOT_TRACK: "1",
    });
    expect(disabled.active).toBe(false);
    expect(disabled.disabledByEnv).toBe(true);
  });

  test("persists stable anonymous distinct_id and recovers from corrupt JSON", async () => {
    const profile = await makeTempDir("flecten-telemetry-profile-");
    const cwd = await makeTempDir("flecten-telemetry-cwd-");
    const first = await loadOrCreateDistinctId(cwd, { FLECTEN_PROFILE: profile });
    expect(first.startsWith("anon_")).toBe(true);
    const second = await loadOrCreateDistinctId(cwd, { FLECTEN_PROFILE: profile });
    expect(second).toBe(first);

    await writeFile(join(profile, "telemetry-id.json"), "{broken json");
    const regenerated = await loadOrCreateDistinctId(cwd, { FLECTEN_PROFILE: profile });
    expect(regenerated.startsWith("anon_")).toBe(true);
    expect(regenerated).not.toBe(first);
    const stored = JSON.parse(await readFile(join(profile, "telemetry-id.json"), "utf8"));
    expect(stored.distinctId).toBe(regenerated);
  });
});

describe("telemetry zero-PII sanitization", () => {
  test("normalizes tools, providers, models, failures, and redacts strings", () => {
    expect(normalizeToolName("terminal")).toBe("terminal");
    expect(normalizeToolName("mcp_github_get_issue")).toBe("mcp");
    expect(normalizeToolName("my_private_module_tool")).toBe("module_tool");

    expect(normalizeProvider("anthropic")).toBe("anthropic");
    expect(normalizeProvider("corp-gateway")).toBe("custom");
    expect(normalizeModel("anthropic", "claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
    expect(normalizeModel("corp-gateway", "internal-secret-model")).toBe("custom");

    expect(classifyToolFailure({ ok: false, output: "", data: { timedOut: true } })).toBe(
      "timeout",
    );
    expect(classifyToolFailure({ ok: false, output: "", data: { kind: "sandbox" } })).toBe(
      "sandbox",
    );
    expect(classifyToolFailure({ ok: false, output: "", data: { status: 503 } })).toBe("transient");
    expect(classifyToolFailure({ ok: false, output: "", data: { exitCode: 127 } })).toBe(
      "exit_nonzero",
    );
    expect(
      classifyToolFailureDetail({
        ok: false,
        output: "",
        data: { kind: "hook", event: "preToolUse" },
      }),
    ).toEqual({ error_kind: "hook", hook_event: "preToolUse" });
    expect(
      classifyToolFailureDetail({
        ok: false,
        output: "",
        data: { kind: "approval", by: "timeout" },
      }),
    ).toEqual({ error_kind: "approval", approval_by: "timeout" });
    expect(
      classifyToolFailureDetail({
        ok: false,
        output: "",
        data: { errorCode: "ENOENT" },
      }),
    ).toEqual({ error_kind: "os_error", errno: "ENOENT" });
    expect(
      classifyToolFailureDetail({
        ok: false,
        output: "",
        data: { status: 404 },
      }),
    ).toEqual({ error_kind: "client", http_status: 404 });

    const err = Object.assign(new Error("secret sk-abcdefghijk999 /home/oleksandr"), {
      code: "EACCES",
    });
    const classified = classifyError(err);
    expect(classified).toEqual({ error_name: "Error", error_code: "EACCES" });
    expect(JSON.stringify(classified)).not.toContain("oleksandr");
    expect(JSON.stringify(classified)).not.toContain("sk-");

    const sanitized = sanitizeProperties({
      ok: true,
      count: 42,
      badNum: Number.NaN,
      secret: "token sk-abcdefghijk123",
      nested: { leak: "nope" },
      list: ["nope"],
    });
    expect(sanitized.ok).toBe(true);
    expect(sanitized.count).toBe(42);
    expect(sanitized.badNum).toBeUndefined();
    expect(sanitized.nested).toBeUndefined();
    expect(sanitized.list).toBeUndefined();
    expect(String(sanitized.secret)).not.toContain("sk-abcdefghijk123");
  });

  test("validates telemetry.track commands strictly", () => {
    expect(
      TelemetryTrackCommandSchema.safeParse({
        type: "telemetry.track",
        event: "ui.screen_viewed",
        properties: {
          screen: "agent",
          surface: "changes",
          layout: "split",
          viewport_bucket: "wide",
        },
      }).success,
    ).toBe(true);

    expect(
      TelemetryTrackCommandSchema.safeParse({
        type: "telemetry.track",
        event: "ui.screen_viewed",
        properties: {
          screen: "agent",
          surface: "changes",
          layout: "split",
          viewport_bucket: "wide",
          prompt: "secret user prompt",
        },
      }).success,
    ).toBe(false);

    expect(
      TelemetryTrackCommandSchema.safeParse({
        type: "telemetry.track",
        event: "shell.error",
        properties: {
          kind: "renderer_load_failed",
          error_code: -6,
        },
      }).success,
    ).toBe(true);

    expect(
      TelemetryTrackCommandSchema.safeParse({
        type: "telemetry.track",
        event: "custom.leak",
        properties: { text: "nope" },
      }).success,
    ).toBe(false);
  });

  test("classifyFailure extracts structured error metadata without leaking messages", () => {
    expect(classifyFailure(new MissingKeyError("openai", "OPENAI_API_KEY"))).toMatchObject({
      error_kind: "missing_api_key",
      error_code: "provider_failed",
      error_name: "MissingKeyError",
    });
    expect(classifyFailure(new LimitError("secret sk-1234", "five_hour", 999))).toMatchObject({
      error_kind: "provider_limit",
      limit_kind: "five_hour",
    });
    expect(
      classifyFailure(
        new ProviderResponseError({
          protocol: "openai-responses",
          status: "failed",
          outcome: "incomplete",
          frames: 3,
          invalidFrames: 1,
          unsupportedFrames: 0,
          textBytes: 0,
          reasoningBytes: 0,
          toolCalls: 0,
          usage: "missing",
          terminal: false,
          durationMs: 120,
        }),
      ),
    ).toMatchObject({
      error_kind: "provider_stream",
      response_outcome: "incomplete",
    });
    expect(
      classifyFailure(
        new TransportError("bearer tok-secret", {
          reason: "http",
          status: 429,
          providerCode: "rate_limit_exceeded",
          limitKind: "rate",
          retryable: true,
        }),
      ),
    ).toMatchObject({
      error_kind: "transport_http",
      http_status: 429,
      provider_code: "rate_limit_exceeded",
      limit_kind: "rate",
      retryable: true,
    });
    expect(classifyFailure(new ToolFailure("validation", "secret path"))).toEqual({
      error_kind: "tool_validation",
      error_name: "ToolFailure",
    });
    expect(classifyFailure(new HarnessError("context_overflow", "/home/secret"))).toMatchObject({
      error_kind: "context_overflow",
      error_code: "context_overflow",
    });
    expect(classifyFailure(new ProjectLockedError(42, "/secret/lock"))).toEqual({
      error_kind: "project_locked",
      error_name: "ProjectLockedError",
    });
    const zodResult = z.object({ n: z.number() }).safeParse({ n: "bad" });
    expect(zodResult.success).toBe(false);
    if (!zodResult.success) {
      expect(classifyFailure(new ZodError(zodResult.error.issues))).toMatchObject({
        error_kind: "validation_error",
        error_code: "invalid_type",
        error_name: "ZodError",
      });
    }
    expect(classifyFailure(new DOMException("aborted", "AbortError"))).toEqual({
      error_kind: "aborted",
      error_name: "AbortError",
    });
    const osErr = classifyFailure(
      Object.assign(new Error("ENOENT /home/oleksandr/secret"), { code: "ENOENT" }),
    );
    expect(osErr).toEqual({ error_kind: "os_error", error_code: "ENOENT", error_name: "Error" });
    expect(JSON.stringify(osErr)).not.toContain("oleksandr");
  });

  test("ToolRegistry preserves diagnostic errorKind, errorCode, and retry attempt counts", async () => {
    const dir = await makeTempDir("flecten-registry-diag-");
    let runs = 0;
    const limits = {
      maxOutputBytes: 4096,
      maxOutputLines: 100,
      bashTimeoutMs: 5000,
      readLimitLines: 100,
    };
    const registry = new ToolRegistry(
      [
        {
          name: "mcp_demo_tool",
          source: "mcp",
          description: "deferred mcp",
          parameters: { type: "object", properties: {} },
          schema: z.object({}).strict(),
          mutating: false,
          execute: async () => ({ ok: true, output: "ok" }),
        },
        {
          name: "read",
          description: "flaky read",
          parameters: { type: "object", properties: { path: { type: "string" } } },
          schema: z.object({ path: z.string().min(1) }),
          mutating: false,
          execute: async () => {
            runs += 1;
            if (runs === 1) {
              throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
            }
            return { ok: true, output: "recovered" };
          },
        },
        {
          name: "write",
          description: "throws enoent",
          parameters: { type: "object", properties: {} },
          schema: z.object({}),
          mutating: true,
          execute: async () => {
            throw Object.assign(new Error("missing file"), { code: "ENOENT" });
          },
        },
      ],
      { limits, deferredMcp: true },
    );

    const unknown = registry.prepare({ id: "u1", name: "missing_tool", args: {} });
    if (!unknown.error) throw new Error("expected unknown tool error");
    expect(classifyToolFailureDetail(unknown.error)).toEqual({ error_kind: "unknown_tool" });

    const inactive = registry.prepare({ id: "u2", name: "mcp_demo_tool", args: {} });
    if (!inactive.error) throw new Error("expected inactive mcp error");
    expect(classifyToolFailureDetail(inactive.error)).toEqual({ error_kind: "mcp_inactive" });

    const invalidArgs = registry.prepare({ id: "u3", name: "read", args: {} });
    if (!invalidArgs.error) throw new Error("expected invalid args error");
    expect(classifyToolFailureDetail(invalidArgs.error)).toEqual({ error_kind: "invalid_args" });

    const ctx = {
      sessionId: "s1",
      cwd: dir,
      signal: new AbortController().signal,
      logDir: dir,
      limits,
      reads: new ReadTracker(),
    };
    const recovered = await registry.run({ id: "r1", name: "read", args: { path: "a.txt" } }, ctx);
    expect(recovered.ok).toBe(true);
    expect(recovered.attempts).toBe(2);

    const enoent = await registry.run({ id: "w1", name: "write", args: {} }, ctx);
    expect(enoent.ok).toBe(false);
    expect(classifyToolFailureDetail(enoent)).toEqual({ error_kind: "os_error", errno: "ENOENT" });
  });
});

describe("PostHogClient batching and backoff", () => {
  test("ships /batch/ payloads, retries 500s with backoff, and drops 400s", async () => {
    let status = 200;
    const received: Array<{ api_key: string; historical_migration: boolean; batch: unknown[] }> =
      [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        received.push((await request.json()) as (typeof received)[number]);
        return Response.json({ status: status === 200 ? 1 : 0 }, { status });
      },
    });
    let clock = 10_000;
    const client = new PostHogClient({
      getTarget: () => ({ apiKey: "phc_local", batchUrl: `${server.url.toString()}batch/` }),
      flushIntervalMs: 0,
      batchSize: 2,
      maxQueueSize: 5,
      now: () => clock,
    });
    try {
      client.enqueue({
        event: "a",
        distinct_id: "anon_1",
        timestamp: new Date(clock).toISOString(),
        uuid: "u1",
        properties: { $process_person_profile: false },
      });
      expect(client.queueLength).toBe(1);

      status = 500;
      await client.flush();
      expect(client.queueLength).toBe(1);
      expect(received).toHaveLength(1);

      status = 200;
      await client.flush();
      expect(received).toHaveLength(1);

      clock += 35_000;
      await client.flush();
      expect(received).toHaveLength(2);
      expect(client.queueLength).toBe(0);
      expect(received[1]?.api_key).toBe("phc_local");
      expect(received[1]?.historical_migration).toBe(false);
      expect(received[1]?.batch).toHaveLength(1);

      status = 400;
      client.enqueue({
        event: "bad",
        distinct_id: "anon_1",
        timestamp: new Date(clock).toISOString(),
        uuid: "u2",
        properties: {},
      });
      await client.flush();
      expect(client.queueLength).toBe(0);
    } finally {
      await client.shutdown();
      server.stop(true);
    }
  });
});
