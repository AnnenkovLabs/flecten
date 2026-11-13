import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HooksConfigSchema } from "../../src/config/schema-sections";
import type { CanonicalHookMatcher } from "../../src/core/hooks/types";
import { cleanupHooks, hook, hooksWith, run, runner, tempDir } from "../helpers/hooks";

afterEach(cleanupHooks);

describe("hook runner", () => {
  test("passes JSON to the hook and returns additional context", async () => {
    const cwd = await tempDir();
    const log = join(cwd, "hooks.jsonl");
    process.env.FLECTEN_HOOK_LOG = log;
    const result = await run(hooksWith({ preToolUse: [hook("context")] }), "preToolUse", {
      cwd,
      toolName: "read",
      toolArgs: { path: "a.ts" },
    });

    expect(result.blocked).toBe(false);
    expect(result.context).toEqual(["context from preToolUse"]);
    expect(result.runs[0]).toMatchObject({ event: "preToolUse", ok: true });
    const logged = JSON.parse((await readFile(log, "utf8")).trim()) as {
      event: string;
      input: { toolName: string; toolArgs: { path: string } };
    };
    expect(logged).toMatchObject({ event: "preToolUse", input: { toolName: "read" } });
    expect(logged.input.toolArgs.path).toBe("a.ts");
  });

  test("blocks on exit code 2 and honors the exact tool matcher", async () => {
    const cwd = await tempDir();
    const config = hooksWith({ preToolUse: [hook("deny", "bash")] });

    const skipped = await run(config, "preToolUse", { cwd, toolName: "read" });
    expect(skipped.runs).toHaveLength(0);

    const blocked = await run(config, "preToolUse", { cwd, toolName: "bash" });
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toBe("denied by preToolUse");
    expect(blocked.runs[0]?.ok).toBe(false);
  });

  test("times out without blocking in non-strict mode", async () => {
    const cwd = await tempDir();
    const result = await run(hooksWith({ preToolUse: [hook("timeout", "*", 100)] }), "preToolUse", {
      cwd,
      toolName: "bash",
    });
    expect(result.blocked).toBe(false);
    expect(result.runs[0]).toMatchObject({ ok: false, error: "hook timed out" });
  });
});

describe("fail-closed hooks", () => {
  test("strict mode blocks on timeout and records the failure", async () => {
    const cwd = await tempDir();
    const config = hooksWith({ preToolUse: [hook("timeout", "*", 100)] }, true);
    const result = await run(config, "preToolUse", { cwd, toolName: "bash" });
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("failed closed");
    expect(result.runs[0]).toMatchObject({ ok: false, error: "hook timed out" });
  });

  test("handles crashes in strict and non-strict mode", async () => {
    const cwd = await tempDir();
    const hooks = { userPromptSubmit: [hook("crash")] };

    const lenient = await run(hooksWith(hooks), "userPromptSubmit", { cwd, prompt: "hello" });
    expect(lenient.blocked).toBe(false);
    expect(lenient.runs[0]?.error).toContain("code 1");

    const strict = await run(hooksWith(hooks, true), "userPromptSubmit", { cwd, prompt: "hello" });
    expect(strict.blocked).toBe(true);
    expect(strict.reason).toContain("failed closed");
    expect(strict.runs[0]?.ok).toBe(false);
  });

  test("failClosed from flecten.config.json blocks only its own hook's failures", async () => {
    const cwd = await tempDir();
    const crash = hook("crash");
    const config = HooksConfigSchema.parse({
      userPromptSubmit: [{ command: crash.command, failClosed: true }],
      preToolUse: [{ command: crash.command }],
    });

    const closed = await run(config, "userPromptSubmit", { cwd, prompt: "hello" });
    expect(closed.blocked).toBe(true);
    expect(closed.reason).toContain("failed closed");

    const open = await run(config, "preToolUse", { cwd, toolName: "read" });
    expect(open.blocked).toBe(false);
    expect(open.runs[0]?.ok).toBe(false);
  });

  test("handles invalid JSON and schema errors in both modes", async () => {
    const cwd = await tempDir();
    const invalidJson = { preToolUse: [hook("invalid-json")] };

    const lenient = await run(hooksWith(invalidJson), "preToolUse", { cwd, toolName: "read" });
    expect(lenient.blocked).toBe(false);
    expect(lenient.runs[0]?.error).toContain("invalid hook JSON");

    const strictJson = await run(hooksWith(invalidJson, true), "preToolUse", {
      cwd,
      toolName: "read",
    });
    expect(strictJson.blocked).toBe(true);
    expect(strictJson.reason).toContain("failed closed");

    const schema = await run(hooksWith({ preToolUse: [hook("bad-schema")] }, true), "preToolUse", {
      cwd,
      toolName: "read",
    });
    expect(schema.blocked).toBe(true);
    expect(schema.runs[0]?.error).toContain("invalid hook response");
  });

  test("strict mode cannot block an event without blocking rights", async () => {
    const cwd = await tempDir();
    const result = await run(hooksWith({ notification: [hook("crash")] }, true), "notification", {
      cwd,
      notification: { level: "info", message: "hello" },
    });
    expect(result.blocked).toBe(false);
    expect(result.runs[0]?.ok).toBe(false);
  });

  test("cancellation before start does not spawn the hook", async () => {
    const cwd = await tempDir();
    const mark = join(cwd, "markers.txt");
    process.env.FLECTEN_HOOK_MARK = mark;
    const controller = new AbortController();
    controller.abort();
    const result = await runner(hooksWith({ preToolUse: [hook("mark")] })).run(
      "preToolUse",
      { sessionId: "s_test", cwd, toolName: "read" },
      controller.signal,
    );
    expect(result.blocked).toBe(false);
    expect(result.runs[0]?.error).toBe("hook aborted");
    expect(await Bun.file(mark).exists()).toBe(false);
  });
});

describe("hook events", () => {
  test("runs the new events with typed input and blocking rights", async () => {
    const cwd = await tempDir();
    const log = join(cwd, "hooks.jsonl");
    process.env.FLECTEN_HOOK_LOG = log;
    const config = hooksWith({
      permission: [hook("deny")],
      compact: [hook("context")],
      notification: [hook("deny")],
      subagent: [hook("context")],
      toolBatch: [hook("deny")],
    });

    const permission = await run(config, "permission", {
      cwd,
      permission: { action: "shell", policy: "ask", tool: "bash", target: "echo hi" },
    });
    expect(permission.blocked).toBe(true);

    const compact = await run(config, "compact", {
      cwd,
      compact: { summary: "short", reason: "auto" },
    });
    expect(compact.context).toEqual(["context from compact"]);

    const notification = await run(config, "notification", {
      cwd,
      notification: { level: "warning", message: "hello" },
    });
    expect(notification.blocked).toBe(false);

    const subagent = await run(config, "subagent", {
      cwd,
      subagent: { agent: "worker", phase: "start" },
    });
    expect(subagent.context).toEqual(["context from subagent"]);

    const toolBatch = await run(config, "toolBatch", {
      cwd,
      toolBatch: { tools: [{ name: "read", args: { path: "a.ts" } }], parallel: true },
    });
    expect(toolBatch.blocked).toBe(true);

    const records = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string; input: Record<string, unknown> });
    expect(records.map((record) => record.event)).toEqual([
      "permission",
      "compact",
      "notification",
      "subagent",
      "toolBatch",
    ]);
    expect(records[0]?.input.permission).toMatchObject({ action: "shell", policy: "ask" });
    expect(records[1]?.input.compact).toMatchObject({ summary: "short", reason: "auto" });
    expect(records[2]?.input.notification).toMatchObject({ level: "warning" });
    expect(records[3]?.input.subagent).toMatchObject({ agent: "worker", phase: "start" });
    expect(records[4]?.input.toolBatch).toMatchObject({ parallel: true });
  }, 20_000);
});

describe("canonical matcher", () => {
  test("matches tool with canonical command and path fields", async () => {
    const cwd = await tempDir();
    const commandMatcher: CanonicalHookMatcher = { tool: "bash", commandPrefix: "git status" };
    const commands = hooksWith({ preToolUse: [hook("context", commandMatcher)] });

    const matched = await run(commands, "preToolUse", {
      cwd,
      toolName: "bash",
      toolArgs: { command: "git status --short" },
    });
    expect(matched.runs).toHaveLength(1);
    const otherCommand = await run(commands, "preToolUse", {
      cwd,
      toolName: "bash",
      toolArgs: { command: "git push" },
    });
    expect(otherCommand.runs).toHaveLength(0);
    const otherTool = await run(commands, "preToolUse", {
      cwd,
      toolName: "read",
      toolArgs: { command: "git status" },
    });
    expect(otherTool.runs).toHaveLength(0);

    const pathMatcher: CanonicalHookMatcher = { tool: "read", path: "src/a.ts" };
    const paths = hooksWith({ preToolUse: [hook("context", pathMatcher)] });
    const relative = await run(paths, "preToolUse", {
      cwd,
      toolName: "read",
      toolArgs: { path: "src/a.ts" },
    });
    const absolute = await run(paths, "preToolUse", {
      cwd,
      toolName: "read",
      toolArgs: { file_path: join(cwd, "src/a.ts") },
    });
    const sibling = await run(paths, "preToolUse", {
      cwd,
      toolName: "read",
      toolArgs: { path: "src/ab.ts" },
    });
    expect([relative.runs.length, absolute.runs.length, sibling.runs.length]).toEqual([1, 1, 0]);
  });

  test("does not treat a string matcher as a glob", async () => {
    const cwd = await tempDir();
    const result = await run(hooksWith({ preToolUse: [hook("context", "ba*")] }), "preToolUse", {
      cwd,
      toolName: "bash",
    });
    expect(result.runs).toHaveLength(0);
  });
});
