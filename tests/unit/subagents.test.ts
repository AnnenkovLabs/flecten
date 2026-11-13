import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { builtinSubagentSpecs } from "../../src/core/subagents/builtin";
import { loadSubagentDefinitions } from "../../src/core/subagents/definitions";
import { createSubagentRuntime } from "../../src/core/subagents/factory";
import { mergeSubagentSpecs, SubagentRegistry } from "../../src/core/subagents/registry";
import { SubagentRunner } from "../../src/core/subagents/runner";
import type { SubagentChildRequest, SubagentSpec } from "../../src/core/subagents/types";
import { runTask, type TaskToolContext, taskTool } from "../../src/tools/task/run";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const resultSchema = z
  .object({
    summary: z.string().min(1),
    files: z.array(z.string()).default([]),
  })
  .strict();

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix = "liquid-subagents-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function markdownDefinition(name: string, body = "You are a subagent."): string {
  return [
    "---",
    `name: ${name}`,
    "description: Loaded from Markdown",
    "model: child-model",
    "provider: child-provider",
    "allowed-tools:",
    "  - read",
    "  - grep",
    "permissions:",
    "  - action: read",
    "    policy: allow",
    "budget:",
    "  maxTurns: 7",
    "  maxTokens: 2000",
    "---",
    "",
    body,
    "",
  ].join("\n");
}

function jsonDefinition(name: string): string {
  return JSON.stringify({
    name,
    description: "Loaded from JSON",
    model: "json-model",
    provider: "json-provider",
    allowedTools: ["read"],
    permissions: [{ action: "read", policy: "allow" }],
    budget: { maxTurns: 4, maxTokens: 800, maxCost: 0.05 },
    systemPrompt: "You are the JSON subagent.",
  });
}

function makeSpec(
  overrides: {
    id?: string;
    allowedTools?: readonly string[];
    budget?: { maxTurns: number; maxTokens: number; maxCost?: number };
  } = {},
): SubagentSpec {
  return {
    id: overrides.id ?? "scout",
    name: "Scout",
    description: "Read-only recon",
    systemPrompt: "You are Scout.",
    allowedTools: overrides.allowedTools ?? ["read", "grep"],
    permissions: [{ action: "read", policy: "allow" }],
    budget: overrides.budget ?? { maxTurns: 10, maxTokens: 1000 },
    resultSchema,
  };
}

function usage(input = 1, output = 1, cost?: number) {
  return {
    input,
    output,
    cached: 0,
    ...(cost === undefined ? {} : { cost }),
  };
}

function toolContext(): ToolContext {
  return {
    sessionId: "s_test",
    cwd: process.cwd(),
    signal: new AbortController().signal,
    logDir: "/tmp/liquid-task",
    limits: {
      maxOutputBytes: 50_000,
      maxOutputLines: 2000,
      bashTimeoutMs: 10_000,
      readLimitLines: 2000,
    },
    reads: new ReadTracker(),
  };
}

describe("subagent definitions", () => {
  test("loads Markdown and JSON roles with model, tools, permissions and budget", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "scout.md"), markdownDefinition("scout"));
    await writeFile(join(dir, "planner.json"), jsonDefinition("planner"));

    const specs = loadSubagentDefinitions([dir, join(dir, "missing")]);
    expect(specs.map((spec) => spec.id)).toEqual(["planner", "scout"]);

    const planner = specs[0];
    const scout = specs[1];
    expect(scout?.source).toBe("definition");
    expect(scout?.sourcePath).toBe(join(dir, "scout.md"));
    expect(scout?.systemPrompt).toContain("You are a subagent.");
    expect(scout?.systemPrompt).toContain('"summary"');
    expect(scout?.allowedTools).toEqual(["read", "grep"]);
    expect(scout?.model).toBe("child-model");
    expect(scout?.provider).toBe("child-provider");
    expect(scout?.budget).toEqual({ maxTurns: 7, maxTokens: 2000 });
    expect(scout?.permissions).toEqual([{ action: "read", policy: "allow" }]);

    expect(planner?.allowedTools).toEqual(["read"]);
    expect(planner?.budget.maxCost).toBe(0.05);
    expect(planner?.resultSchema.safeParse({ summary: "ok", verdict: "pass" }).success).toBe(true);
  });

  test("rejects invalid schemas and name mismatches with the file path", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "broken.md"),
      "---\nname: broken\ndescription: no budget\n---\nbody\n",
    );
    expect(() => loadSubagentDefinitions([dir])).toThrow(/broken\.md.*budget/);

    const other = await tempDir();
    await writeFile(join(other, "scout.md"), markdownDefinition("not-scout"));
    expect(() => loadSubagentDefinitions([other])).toThrow(/must match file name "scout"/);
  });

  test("rejects symlinked files and duplicate ids deterministically", async () => {
    const outside = await tempDir();
    const outsideFile = join(outside, "escape.md");
    await writeFile(outsideFile, markdownDefinition("escape"));
    const linked = await tempDir();
    await symlink(outsideFile, join(linked, "escape.md"));
    expect(() => loadSubagentDefinitions([linked])).toThrow(/must be a regular file/);

    const first = await tempDir();
    const second = await tempDir();
    await writeFile(join(first, "scout.md"), markdownDefinition("scout"));
    await writeFile(join(second, "scout.md"), markdownDefinition("scout"));
    expect(() => loadSubagentDefinitions([first, second])).toThrow(
      `duplicate subagent definition: scout (${join(first, "scout.md")}, ${join(second, "scout.md")})`,
    );
  });

  test("definitions override built-in roles while duplicate definitions are rejected", async () => {
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "explore.md"),
      markdownDefinition("explore", "You are a custom explorer."),
    );

    const runtime = createSubagentRuntime({
      directories: [dir],
      runChild: async () => ({ text: JSON.stringify({ summary: "ok" }), usage: usage() }),
    });
    const explore = runtime.registry.get("explore");
    expect(explore?.source).toBe("definition");
    expect(explore?.systemPrompt).toContain("custom explorer");
    expect(runtime.registry.list().map((spec) => spec.id)).toEqual([
      "explore",
      "implement",
      "review",
    ]);

    expect(() =>
      mergeSubagentSpecs(builtinSubagentSpecs, [
        { ...makeSpec(), sourcePath: "a.md" },
        { ...makeSpec(), sourcePath: "b.md" },
      ]),
    ).toThrow("duplicate subagent definition: scout (a.md, b.md)");
  });
});

describe("SubagentRegistry", () => {
  test("registers, gets and lists specs", () => {
    const registry = new SubagentRegistry([makeSpec()]);
    expect(registry.get("scout")?.name).toBe("Scout");
    expect(registry.list().map((spec) => spec.id)).toEqual(["scout"]);
    expect(registry.get("missing")).toBeUndefined();
  });

  test("rejects duplicate ids on register and construction", () => {
    const registry = new SubagentRegistry();
    registry.register(makeSpec());
    expect(() => registry.register(makeSpec())).toThrow("subagent already registered: scout");
    expect(() => new SubagentRegistry([makeSpec(), makeSpec()])).toThrow(
      "subagent already registered: scout",
    );
  });
});

describe("SubagentRunner", () => {
  test("isolates the child context", async () => {
    const runner = new SubagentRunner(new SubagentRegistry([makeSpec()]));
    let seen: SubagentChildRequest | undefined;
    const result = await runner.run("scout", "find the parser", {
      parentContext: "the parent already discussed the parser",
      runChild: async (request) => {
        seen = request;
        return { text: JSON.stringify({ summary: "found it" }), usage: usage() };
      },
    });

    expect(result.ok).toBe(true);
    expect(seen?.messages).toEqual([{ role: "user", content: "find the parser" }]);
    expect(seen?.parentContext).toBe("the parent already discussed the parser");
    expect(seen?.systemPrompt).toBe("You are Scout.");
    expect(seen?.allowedTools).toEqual(["read", "grep"]);
    expect(seen?.messages.some((message) => message.content.includes("parent already"))).toBe(
      false,
    );
  });

  test("rejects a tool outside the allowlist", async () => {
    const runner = new SubagentRunner(new SubagentRegistry([makeSpec()]));
    const denied = await runner.run("scout", "inspect", {
      runChild: async () => ({
        text: JSON.stringify({ summary: "done" }),
        usage: usage(),
        toolCalls: [
          { id: "1", name: "read", args: {} },
          { id: "2", name: "bash", args: { command: "rm -rf /" } },
        ],
      }),
    });
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain("bash");
    expect(denied.error).toContain("not allowed");
  });

  test("rejects a child that exceeds its budgets", async () => {
    const tokenSpec = makeSpec({ budget: { maxTurns: 10, maxTokens: 5 } });
    const tokenRunner = new SubagentRunner(new SubagentRegistry([tokenSpec]));
    const tokens = await tokenRunner.run("scout", "inspect", {
      runChild: async () => ({
        text: JSON.stringify({ summary: "too much" }),
        usage: usage(4, 4),
      }),
    });
    expect(tokens.ok).toBe(false);
    expect(tokens.error).toContain("token budget");

    const turnSpec = makeSpec({ budget: { maxTurns: 1, maxTokens: 1000 } });
    const turnRunner = new SubagentRunner(new SubagentRegistry([turnSpec]));
    const turns = await turnRunner.run("scout", "inspect", {
      runChild: async () => ({
        text: JSON.stringify({ summary: "looped" }),
        usage: usage(),
        turns: 2,
        toolCalls: [
          { id: "1", name: "read", args: {} },
          { id: "2", name: "read", args: {} },
        ],
      }),
    });
    expect(turns.ok).toBe(false);
    expect(turns.error).toContain("turn budget");

    const costSpec = makeSpec({ budget: { maxTurns: 10, maxTokens: 1000, maxCost: 0.01 } });
    const costRunner = new SubagentRunner(new SubagentRegistry([costSpec]));
    const cost = await costRunner.run("scout", "inspect", {
      runChild: async () => ({
        text: JSON.stringify({ summary: "expensive" }),
        usage: usage(1, 1, 0.02),
      }),
    });
    expect(cost.ok).toBe(false);
    expect(cost.error).toContain("cost budget");
  });

  test("validates the child result with Zod", async () => {
    const runner = new SubagentRunner(new SubagentRegistry([makeSpec()]));

    const valid = await runner.run("scout", "inspect", {
      runChild: async () => ({
        text: JSON.stringify({ summary: "ok", files: ["src/a.ts"] }),
        usage: usage(),
      }),
    });
    expect(valid.ok).toBe(true);
    expect(valid.data).toEqual({ summary: "ok", files: ["src/a.ts"] });

    const invalid = await runner.run("scout", "inspect", {
      runChild: async () => ({ text: JSON.stringify({ files: [] }), usage: usage() }),
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.error).toContain("invalid result");
    expect(invalid.error).toContain("summary");

    const notJson = await runner.run("scout", "inspect", {
      runChild: async () => ({ text: "plain text", usage: usage() }),
    });
    expect(notJson.ok).toBe(false);
    expect(notJson.error).toContain("not valid JSON");
  });

  test("returns child errors and unknown agents", async () => {
    const runner = new SubagentRunner(new SubagentRegistry([makeSpec()]));
    const failed = await runner.run("scout", "inspect", {
      runChild: async () => ({ text: "partial", usage: usage(2, 3), error: "provider failed" }),
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe("provider failed");
    expect(failed.usage).toEqual(usage(2, 3));

    const unknown = await runner.run("missing", "inspect", {
      runChild: async () => ({ text: JSON.stringify({ summary: "never" }), usage: usage() }),
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain("Unknown subagent");
  });
});

describe("task tool", () => {
  test("exposes the agent, prompt and context shape", () => {
    expect(taskTool.name).toBe("task");
    expect(taskTool.parameters.type).toBe("object");
    expect(taskTool.schema.safeParse({ operation: "list" }).success).toBe(true);
    expect(taskTool.schema.safeParse({ operation: "wait" }).success).toBe(false);
    expect(taskTool.schema.safeParse({ operation: "stop", id: "child" }).success).toBe(true);
    expect(
      taskTool.schema.safeParse({ agent: "scout", prompt: "inspect", context: "background" })
        .success,
    ).toBe(true);
    expect(taskTool.schema.safeParse({ agent: "scout" }).success).toBe(false);
    expect(
      taskTool.schema.safeParse({ agent: "scout", prompt: "inspect", extra: true }).success,
    ).toBe(false);
  });

  test("fails clearly without an injected runner factory", async () => {
    const result = await runTask({ agent: "scout", prompt: "inspect" }, toolContext());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no subagent runner factory");
  });

  test("runs through the injected factory and returns the child result", async () => {
    const runner = new SubagentRunner(new SubagentRegistry([makeSpec()]));
    let seen: SubagentChildRequest | undefined;
    const context: TaskToolContext = {
      ...toolContext(),
      subagentRunnerFactory: () => ({
        runner,
        runChild: async (request) => {
          seen = request;
          return { text: JSON.stringify({ summary: "child summary" }), usage: usage(3, 2) };
        },
      }),
    };

    const result = await runTask(
      { agent: "scout", prompt: "inspect", context: "parent background" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe(JSON.stringify({ summary: "child summary" }));
    expect(result.data).toMatchObject({ kind: "subagent", agent: "scout" });
    expect(seen?.parentContext).toBe("parent background");
    expect(seen?.messages).toEqual([{ role: "user", content: "inspect" }]);
  });
});
