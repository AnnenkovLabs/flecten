import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildCrashReport,
  buildDiagnosticsBundle,
  describeConfigShape,
  type LogRecord,
} from "../../src/observability/diagnostics";

const now = new Date("2026-10-25T12:00:00.000Z");
describe("crash and diagnostics", () => {
  test("crash report keeps the error code and redacts logs", () => {
    const error = Object.assign(new Error("boom sk-abcdefghijk"), { code: "E_CRASH" });
    const recent: LogRecord[] = [
      {
        ts: now.toISOString(),
        level: "error",
        event: "before",
        traceId: "trace_1",
        data: { token: "sk-secret123456" },
      },
    ];
    const report = buildCrashReport({
      error,
      traceId: "trace_1",
      sessionId: "session_1",
      version: "0.1.0",
      now,
      recentLogs: recent,
    });

    expect(report.error).toMatchObject({
      name: "Error",
      message: "boom [redacted]",
      code: "E_CRASH",
    });
    expect(report.recentLogs[0]?.data.token).toBe("[redacted]");
    expect(JSON.stringify(report)).not.toContain("sk-");
  });

  test("diagnostics bundle has metadata, safe providers and config shape", () => {
    const siblingPath = `${homedir()}2/file`;
    const bundle = buildDiagnosticsBundle({
      version: "0.1.0",
      commit: "abc123",
      paths: {
        config: "/tmp/project/flecten.config.json",
        home: join(homedir(), "project"),
        sibling: siblingPath,
      },
      providers: [
        {
          name: "openai",
          protocol: "openai-chat",
          baseUrl: "https://api.openai.com/v1?key=sk-secret123456",
          apiKey: "sk-secret123456",
          headers: { Authorization: "Bearer abc.def" },
        },
      ],
      recentErrors: [new Error("provider failed sk-abcdefghijk")],
      config: {
        providers: { openai: { apiKey: "sk-secret123456", baseUrl: "https://api.openai.com/v1" } },
        telemetry: { enabled: false },
      },
      now,
      platform: "linux",
    });

    expect(bundle.app).toEqual({ version: "0.1.0", commit: "abc123", platform: "linux" });
    expect(bundle.paths).toEqual({
      config: "/tmp/project/flecten.config.json",
      home: "~/project",
      sibling: siblingPath,
    });
    expect(bundle.providers).toEqual([
      { name: "openai", protocol: "openai-chat", host: "api.openai.com" },
    ]);
    expect(JSON.parse(JSON.stringify(bundle.configShape))).toEqual({
      type: "object",
      keys: {
        providers: {
          type: "object",
          keys: {
            openai: {
              type: "object",
              keys: { apiKey: { type: "string" }, baseUrl: { type: "string" } },
            },
          },
        },
        telemetry: { type: "object", keys: { enabled: { type: "boolean" } } },
      },
    });

    const text = JSON.stringify(bundle);
    expect(text).not.toContain("sk-secret123456");
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain("?key=");
  });

  test("config shape keeps keys and types but never values", () => {
    expect(describeConfigShape({ secret: "value", nested: { count: 3 } })).toEqual({
      type: "object",
      keys: {
        nested: { type: "object", keys: { count: { type: "number" } } },
        secret: { type: "string" },
      },
    });
  });
});
