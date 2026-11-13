import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import type { ToolCall, ToolResult } from "../../src/core/types";
import {
  TOOL_RETRY_ATTEMPTS,
  TOOL_RETRY_BASE_MS,
  TOOL_RETRY_MAX_MS,
  TOOL_RETRY_MUTATING_ATTEMPTS,
  ToolRegistry,
  toolRetryDelay,
} from "../../src/tools/registry";
import { defineTool, type Tool, type ToolContext, ToolFailure } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-tool-logs-"));
  dirs.push(dir);
  return dir;
}

function context(cwd: string, signal = new AbortController().signal): ToolContext {
  return {
    sessionId: "s_test",
    cwd,
    signal,
    logDir: join(cwd, ".liquid/sessions/s_test/logs"),
    limits,
    reads: new ReadTracker(),
  };
}

function fakeTool(name: string, execute: Tool["execute"], mutating = false): Tool {
  return defineTool({
    name,
    description: `Fake ${name} tool for tests`,
    schema: z.object({}),
    mutating,
    execute: (args, ctx) => execute(args, ctx),
  });
}

function toolCall(id: string, name: string, idempotencyKey?: string): ToolCall {
  return { id, name, args: {}, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) };
}

function transient(): ToolResult {
  return {
    ok: false,
    output: "",
    error: "temporary failure",
    data: { errorKind: "transient" },
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("tool logs", () => {
  test("always writes the full redacted output with a unique name", async () => {
    const cwd = await tempDir();
    const secret = "sk-abcdefghijklmnop";
    const text = Array.from({ length: 40 }, (_, index) => `line ${index} ${secret}`).join("\n");
    const tool = fakeTool("echo", async () => ({ ok: true, output: text }));
    const registry = new ToolRegistry([tool], {
      limits: { ...limits, maxOutputBytes: 2000, maxOutputLines: 20 },
    });

    const result = await registry.run(toolCall("call-1", "echo"), context(cwd));
    const other = await registry.run(toolCall("call-1", "echo"), context(cwd));
    const path = result.fullOutputPath ?? "";

    expect(result.ok).toBe(true);
    expect(path.startsWith(join(cwd, ".liquid/sessions/s_test/logs"))).toBe(true);
    expect(basename(path)).toContain("echo");
    expect(basename(path)).toContain("call-1");
    expect(other.fullOutputPath).not.toBe(path);
    const log = await readFile(path, "utf8");
    expect(log).toContain("line 20");
    expect(log).toContain("line 39");
    expect(log).toContain("[redacted");
    expect(log).not.toContain(secret);
    expect(result.trailer).toContain(`[full output: ${path}]`);
    expect(result.output).not.toContain("line 20");
  });
});

describe("tool retries", () => {
  test("retries safe tools on transient failures", async () => {
    const cwd = await tempDir();
    let attempts = 0;
    const tool = fakeTool("flaky", async () => {
      attempts += 1;
      if (attempts < TOOL_RETRY_ATTEMPTS) throw new ToolFailure("transient", "temporary");
      return { ok: true, output: "recovered" };
    });
    const registry = new ToolRegistry([tool], { limits });

    const result = await registry.run(toolCall("call-2", "flaky"), context(cwd));

    expect(result.ok).toBe(true);
    expect(result.output).toContain("recovered");
    expect(attempts).toBe(TOOL_RETRY_ATTEMPTS);
  });

  test("stops after the bounded retry budget", async () => {
    const cwd = await tempDir();
    let attempts = 0;
    const tool = fakeTool("always", async () => {
      attempts += 1;
      return transient();
    });
    const registry = new ToolRegistry([tool], { limits });

    const result = await registry.run(toolCall("call-3", "always"), context(cwd));

    expect(result.ok).toBe(false);
    expect(attempts).toBe(TOOL_RETRY_ATTEMPTS);
  });

  test("backoff is exponential, jittered and bounded", () => {
    expect(toolRetryDelay(1, 0)).toBe(TOOL_RETRY_BASE_MS);
    expect(toolRetryDelay(2, 0)).toBe(TOOL_RETRY_BASE_MS * 2);
    expect(toolRetryDelay(1, 1)).toBeGreaterThan(TOOL_RETRY_BASE_MS);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const low = toolRetryDelay(attempt, 0);
      const high = toolRetryDelay(attempt, 1);
      expect(low).toBeGreaterThanOrEqual(TOOL_RETRY_BASE_MS);
      expect(high).toBeLessThanOrEqual(TOOL_RETRY_MAX_MS);
      expect(high).toBeGreaterThanOrEqual(low);
    }
    expect(toolRetryDelay(20, 1)).toBe(TOOL_RETRY_MAX_MS);
  });

  test("abort stops retries immediately", async () => {
    const cwd = await tempDir();
    const controller = new AbortController();
    let attempts = 0;
    const tool = fakeTool("slow", async () => {
      attempts += 1;
      setTimeout(() => controller.abort(), 5);
      return transient();
    });
    const registry = new ToolRegistry([tool], { limits });

    const result = await registry.run(toolCall("call-4", "slow"), context(cwd, controller.signal));

    expect(attempts).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("aborted");
  });

  test("mutating tools do not retry without an idempotency key", async () => {
    const cwd = await tempDir();
    let attempts = 0;
    const tool = fakeTool(
      "mutate",
      async () => {
        attempts += 1;
        return transient();
      },
      true,
    );
    const registry = new ToolRegistry([tool], { limits });

    await registry.run(toolCall("call-5", "mutate"), context(cwd));

    expect(attempts).toBe(1);
  });

  test("an idempotency key allows one retry for mutating tools", async () => {
    const cwd = await tempDir();
    let attempts = 0;
    const tool = fakeTool(
      "mutate-keyed",
      async () => {
        attempts += 1;
        return transient();
      },
      true,
    );
    const registry = new ToolRegistry([tool], { limits });

    const result = await registry.run(toolCall("call-6", "mutate-keyed", "idem-1"), context(cwd));

    expect(result.ok).toBe(false);
    expect(attempts).toBe(TOOL_RETRY_MUTATING_ATTEMPTS);
  });

  test("does not retry validation, permission, timeout or 4xx failures", async () => {
    const cwd = await tempDir();
    const failures: Array<Record<string, unknown>> = [
      { errorKind: "validation" },
      { errorKind: "permission" },
      { errorKind: "timeout" },
      { errorKind: "aborted" },
      { errorKind: "client" },
      { status: 400 },
      { status: 429 },
    ];

    for (const [index, data] of failures.entries()) {
      let attempts = 0;
      const name = `no-retry-${index}`;
      const tool = fakeTool(name, async () => {
        attempts += 1;
        return { ok: false, output: "", error: "failed", data };
      });
      const registry = new ToolRegistry([tool], { limits });

      const result = await registry.run(toolCall(`call-7-${index}`, name), context(cwd));

      expect(result.ok).toBe(false);
      expect(attempts).toBe(1);
    }
  });

  test("retries explicit server failures", async () => {
    const cwd = await tempDir();
    let attempts = 0;
    const tool = fakeTool("server", async () => {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false, output: "", error: "unavailable", data: { status: 503 } };
      }
      return { ok: true, output: "ok" };
    });
    const registry = new ToolRegistry([tool], { limits });

    const result = await registry.run(toolCall("call-8", "server"), context(cwd));

    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
  });
});
