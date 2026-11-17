import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath } from "../../src/config/load";
import { HarnessConfigSchema } from "../../src/config/schema";
import { DiagnosticsRuntime } from "../../src/observability/runtime";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

test("runtime records safe operational evidence and exports a local diagnostics bundle", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-diagnostics-"));
  directories.push(cwd);
  const runtime = new DiagnosticsRuntime(cwd);
  runtime.record({ type: "message.delta", sessionId: "s_trace", text: "private prompt" });
  runtime.record({
    type: "tool.finished",
    sessionId: "s_trace",
    call: { id: "c1", name: "read", args: { path: "private-path" } },
    result: { ok: true, output: "private file content", durationMs: 5 },
  });
  runtime.record({
    type: "worker.event",
    sessionId: "s_trace",
    event: {
      type: "provider.retry",
      sessionId: "s_trace_worker",
      kind: "network",
      attempt: 2,
      delayMs: 400,
      until: 900,
      reason: "retryable network failure",
    },
  });
  runtime.record({
    type: "worker.event",
    sessionId: "s_trace",
    event: {
      type: "message.delta",
      sessionId: "s_trace_worker",
      text: "private worker output",
    },
  });
  runtime.record({
    type: "provider.response",
    sessionId: "s_trace",
    response: {
      protocol: "openai-chat",
      status: "failed",
      outcome: "empty_completion",
      requestId: "req-safe",
      frames: 2,
      invalidFrames: 0,
      unsupportedFrames: 0,
      textBytes: 0,
      reasoningBytes: 0,
      toolCalls: 0,
      usage: "missing",
      terminal: true,
      durationMs: 200,
    },
  });
  runtime.record({
    type: "error",
    sessionId: "s_trace",
    code: "tool_failed",
    message: "failure sk-abcdefghijk",
  });
  const config = HarnessConfigSchema.parse({ providers: {}, telemetry: { enabled: false } });
  const bundle = await runtime.bundle(config, configPath(cwd, join(cwd, "custom.json")));
  const text = await readFile(bundle.path, "utf8");
  expect(text).toContain("custom.json");
  expect(text).toContain('"tool.finished": 1');
  expect(text).not.toContain("private prompt");
  expect(text).not.toContain("private-path");
  expect(text).not.toContain("private file content");
  expect(text).not.toContain("sk-abcdefghijk");
  const journal = await readFile(join(cwd, ".flecten", "diagnostics", "events.jsonl"), "utf8");
  expect(journal).toContain("s_trace_worker");
  expect(journal).toContain('"attempt":2');
  expect(journal).toContain('"outcome":"empty_completion"');
  expect(journal).toContain('"requestId":"req-safe"');
  expect(journal).not.toContain("private worker output");
  await runtime.crash(new Error("crash sk-abcdefghijk"));
  expect(await readFile(join(cwd, ".flecten", "diagnostics", "crash.json"), "utf8")).not.toContain(
    "sk-abcdefghijk",
  );
});

test("telemetry sends counters only after explicit opt-in", async () => {
  const received: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push(await request.json());
      return Response.json({ ok: true });
    },
  });
  const cwd = await mkdtemp(join(tmpdir(), "flecten-metrics-"));
  directories.push(cwd);
  const runtime = new DiagnosticsRuntime(cwd);
  const config = HarnessConfigSchema.parse({
    telemetry: { enabled: false, endpoint: server.url.toString() },
  });
  try {
    await runtime.telemetry(config);
    expect(received).toHaveLength(0);
    config.telemetry = { enabled: true, endpoint: server.url.toString() };
    await runtime.telemetry(config);
    expect(received).toHaveLength(1);
    expect(Object.keys(received[0] as object).sort()).toEqual([
      "metrics",
      "platform",
      "schemaVersion",
      "version",
    ]);
  } finally {
    server.stop(true);
  }
});
