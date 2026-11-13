import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createSubagentRuntime } from "../../src/core/subagents/factory";
import { SubagentRegistry } from "../../src/core/subagents/registry";
import { SubagentRunner } from "../../src/core/subagents/runner";
import type { SubagentChildRequest, SubagentSpec } from "../../src/core/subagents/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import type { SubagentRunnerFactory, TaskToolContext } from "../../src/tools/task/run";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

const scout: SubagentSpec = {
  id: "scout",
  name: "Scout",
  description: "Read-only recon",
  systemPrompt: "You are Scout.",
  allowedTools: ["read", "grep"],
  permissions: [{ action: "read", policy: "allow" }],
  budget: { maxTurns: 10, maxTokens: 1000 },
  resultSchema: z
    .object({
      summary: z.string().min(1),
    })
    .strict(),
};

function toolRegistry(): ToolRegistry {
  return new ToolRegistry(builtinTools(), { limits });
}

function context(subagentRunnerFactory?: SubagentRunnerFactory): TaskToolContext {
  const base: TaskToolContext = {
    sessionId: "s_subagent_integration",
    cwd: process.cwd(),
    signal: new AbortController().signal,
    logDir: "/tmp/liquid-subagent-integration",
    limits,
    reads: new ReadTracker(),
  };
  return subagentRunnerFactory === undefined ? base : { ...base, subagentRunnerFactory };
}

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function definitionDir(name = "reviewer", maxTokens = 400): Promise<string> {
  return mkdtemp(join(tmpdir(), "liquid-subagent-child-")).then(async (dir) => {
    dirs.push(dir);
    await writeFile(
      join(dir, `${name}.md`),
      [
        "---",
        `name: ${name}`,
        "description: Check a change",
        "model: fake-child-model",
        "provider: fake",
        "allowed-tools:",
        "  - read",
        "permissions:",
        "  - action: read",
        "    policy: allow",
        "budget:",
        "  maxTurns: 3",
        `  maxTokens: ${maxTokens}`,
        "---",
        "",
        "You review changes.",
        "",
      ].join("\n"),
    );
    return dir;
  });
}

function factory(): SubagentRunnerFactory {
  const runner = new SubagentRunner(new SubagentRegistry([scout]));
  return () => ({
    runner,
    runChild: async () => ({
      text: JSON.stringify({ summary: "found the parser" }),
      usage: { input: 3, output: 2, cached: 0 },
    }),
  });
}

describe("task tool integration", () => {
  test("is registered and runs a child through the factory", async () => {
    const registry = toolRegistry();
    expect(registry.get("task")?.name).toBe("task");

    const result = await registry.run(
      { id: "call-task", name: "task", args: { agent: "scout", prompt: "find the parser" } },
      context(factory()),
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("found the parser");
    expect(result.data).toMatchObject({
      kind: "subagent",
      agent: "scout",
      data: { summary: "found the parser" },
    });
  });

  test("reports an unknown agent clearly", async () => {
    const result = await toolRegistry().run(
      { id: "call-task", name: "task", args: { agent: "ghost", prompt: "inspect" } },
      context(factory()),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown subagent: ghost");
    expect(result.error).toContain("scout");
  });

  test("runs a definition through the task tool with a fake provider", async () => {
    const dir = await definitionDir();
    let seen: SubagentChildRequest | undefined;
    const runtime = createSubagentRuntime({
      directories: [dir],
      toolRegistry: toolRegistry(),
      runChild: async (request) => {
        seen = request;
        return {
          text: JSON.stringify({ summary: "change looks correct", verdict: "pass" }),
          usage: { input: 5, output: 3, cached: 0 },
        };
      },
    });

    const result = await toolRegistry().run(
      { id: "call-task", name: "task", args: { agent: "reviewer", prompt: "review the diff" } },
      context(runtime.factory),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      kind: "subagent",
      agent: "reviewer",
      data: { summary: "change looks correct", verdict: "pass" },
      usage: { input: 5, output: 3, cached: 0 },
    });
    expect(seen?.spec.model).toBe("fake-child-model");
    expect(seen?.spec.provider).toBe("fake");
    expect(seen?.allowedTools).toEqual(["read"]);
    expect(seen?.budget).toEqual({ maxTurns: 3, maxTokens: 400 });
    expect(seen?.systemPrompt).toContain("You review changes.");
  });

  test("enforces the definition budget and returns usage with the error", async () => {
    const dir = await definitionDir("reviewer", 10);
    const runtime = createSubagentRuntime({
      directories: [dir],
      toolRegistry: toolRegistry(),
      runChild: async () => ({
        text: JSON.stringify({ summary: "over budget" }),
        usage: { input: 20, output: 5, cached: 0 },
      }),
    });

    const result = await toolRegistry().run(
      { id: "call-task", name: "task", args: { agent: "reviewer", prompt: "review" } },
      context(runtime.factory),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("token budget");
    expect(result.data).toMatchObject({
      kind: "subagent",
      agent: "reviewer",
      usage: { input: 20, output: 5, cached: 0 },
      error: expect.stringContaining("token budget"),
    });
  });

  test("fails explicitly when no factory is configured", async () => {
    const result = await toolRegistry().run(
      { id: "call-task", name: "task", args: { agent: "scout", prompt: "inspect" } },
      context(),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("unavailable");
    expect(result.error).toContain("no subagent runner factory");
  });
});
