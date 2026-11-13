import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { builtinSubagentSpecs } from "../../src/core/subagents/builtin";
import { createSubagentRuntime } from "../../src/core/subagents/factory";
import type { SubagentChildRequest, SubagentSpec } from "../../src/core/subagents/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import type { SubagentRunnerFactory } from "../../src/tools/task/run";
import type { ToolContext } from "../../src/tools/types";
import { ReadTracker } from "../../src/tools/util/read-tracker";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

const runChild = async (): Promise<never> => {
  throw new Error("runChild is not used in this test");
};

function toolRegistry(): ToolRegistry {
  return new ToolRegistry(builtinTools(), { limits });
}

function toolContext(): ToolContext {
  return {
    sessionId: "s_subagent_builtin",
    cwd: process.cwd(),
    signal: new AbortController().signal,
    logDir: "/tmp/liquid-subagent-builtin",
    limits,
    reads: new ReadTracker(),
  };
}

function customSpec(overrides: Partial<SubagentSpec> = {}): SubagentSpec {
  return {
    id: "custom",
    name: "Custom",
    description: "Custom subagent",
    systemPrompt: "You are Custom.",
    allowedTools: ["read"],
    permissions: [{ action: "read", policy: "allow" }],
    budget: { maxTurns: 5, maxTokens: 1000 },
    resultSchema: z.object({ summary: z.string().min(1) }).strict(),
    ...overrides,
  };
}

function specOf(runtime: ReturnType<typeof createSubagentRuntime>, id: string): SubagentSpec {
  const spec = runtime.registry.get(id);
  if (spec === undefined) throw new Error(`missing spec: ${id}`);
  return spec;
}

describe("builtin subagent specs", () => {
  test("registers explore, implement and review", () => {
    const runtime = createSubagentRuntime({ runChild, toolRegistry: toolRegistry() });
    expect(
      runtime.registry
        .list()
        .map((spec) => spec.id)
        .sort(),
    ).toEqual(["explore", "implement", "review"]);
  });

  test("gives each role explicit tools, permissions and budgets", () => {
    const runtime = createSubagentRuntime({ runChild, toolRegistry: toolRegistry() });
    const explore = specOf(runtime, "explore");
    const implement = specOf(runtime, "implement");
    const review = specOf(runtime, "review");

    expect(explore.allowedTools).toEqual(["read", "grep", "glob", "lsp", "web_fetch"]);
    expect(explore.allowedTools).not.toContain("write");
    expect(explore.allowedTools).not.toContain("bash");
    expect(explore.allowedTools).not.toContain("terminal");
    expect(explore.permissions.length).toBeGreaterThan(0);

    expect(implement.allowedTools).toEqual(
      expect.arrayContaining([
        "read",
        "write",
        "edit",
        "apply_patch",
        "delete",
        "move",
        "bash",
        "terminal",
        "todo",
        "git",
      ]),
    );
    expect(implement.permissions.length).toBeGreaterThan(0);

    expect(review.allowedTools).toEqual(["read", "grep", "glob", "git", "lsp"]);
    expect(review.allowedTools).not.toContain("write");
    expect(review.allowedTools).not.toContain("edit");
    expect(review.permissions.length).toBeGreaterThan(0);
  });

  test("budgets differ per role", () => {
    const budgets = new Set(
      builtinSubagentSpecs.map((spec) => `${spec.budget.maxTurns}:${spec.budget.maxTokens}`),
    );
    expect(budgets.size).toBe(builtinSubagentSpecs.length);
    for (const spec of builtinSubagentSpecs) {
      expect(spec.budget.maxTurns).toBeGreaterThan(0);
      expect(spec.budget.maxTokens).toBeGreaterThan(0);
    }
  });
});

describe("tool allowlist validation", () => {
  test("accepts the builtin specs against the real tool registry", () => {
    expect(() => createSubagentRuntime({ runChild, toolRegistry: toolRegistry() })).not.toThrow();
  });

  test("rejects duplicate spec ids", () => {
    expect(() =>
      createSubagentRuntime({
        specs: [customSpec(), customSpec()],
        runChild,
      }),
    ).toThrow("subagent already registered: custom");
  });

  test("rejects a tool listed twice", () => {
    expect(() =>
      createSubagentRuntime({
        specs: [customSpec({ allowedTools: ["read", "read"] })],
        runChild,
      }),
    ).toThrow('lists tool "read" more than once');
  });

  test("rejects a tool unknown to the passed registry", () => {
    expect(() =>
      createSubagentRuntime({
        specs: [customSpec({ allowedTools: ["read", "teleport"] })],
        runChild,
        toolRegistry: toolRegistry(),
      }),
    ).toThrow('subagent "custom" allows unknown tool "teleport"');
  });
});

describe("subagent runtime factory", () => {
  test("returns a SubagentRunnerFactory that runs the injected child", async () => {
    let seen: SubagentChildRequest | undefined;
    const runtime = createSubagentRuntime({
      toolRegistry: toolRegistry(),
      runChild: async (request) => {
        seen = request;
        return {
          text: JSON.stringify({
            summary: "mapped the repo",
            files: ["src/index.ts"],
            findings: ["entry point is src/index.ts"],
            openQuestions: [],
          }),
          usage: { input: 3, output: 2, cached: 0 },
        };
      },
    });

    const factory: SubagentRunnerFactory = runtime.factory;
    const invocation = factory(toolContext());
    expect(invocation.runner).toBe(runtime.runner);
    expect(invocation.signal).toBeDefined();

    const result = await invocation.runner.run("explore", "map the repo", {
      runChild: invocation.runChild,
      ...(invocation.signal === undefined ? {} : { signal: invocation.signal }),
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      summary: "mapped the repo",
      files: ["src/index.ts"],
      findings: ["entry point is src/index.ts"],
      openQuestions: [],
    });
    expect(seen?.systemPrompt).toBe(specOf(runtime, "explore").systemPrompt);
    expect(seen?.allowedTools).toEqual(specOf(runtime, "explore").allowedTools);
  });
});

describe("result schemas", () => {
  const cases: Array<{ id: string; valid: unknown; invalid: unknown }> = [
    {
      id: "explore",
      valid: {
        summary: "found the parser",
        files: ["src/parser.ts"],
        findings: ["parser has no tests"],
        openQuestions: ["is the legacy parser still used?"],
      },
      invalid: { summary: "found the parser", files: ["src/parser.ts"] },
    },
    {
      id: "implement",
      valid: {
        summary: "added the guard",
        filesChanged: ["src/parser.ts"],
        testsRun: ["bun test tests/parser.test.ts"],
        blockers: [],
      },
      invalid: {
        summary: "added the guard",
        filesChanged: "src/parser.ts",
        testsRun: [],
        blockers: [],
      },
    },
    {
      id: "review",
      valid: {
        verdict: "fail",
        findings: [
          { severity: "high", message: "guard is missing", file: "src/parser.ts", line: 12 },
        ],
        evidence: ["read src/parser.ts", "git diff"],
      },
      invalid: {
        verdict: "maybe",
        findings: [],
        evidence: [],
      },
    },
  ];

  test("accepts a valid payload for every role", () => {
    for (const entry of cases) {
      const spec = builtinSubagentSpecs.find((item) => item.id === entry.id);
      if (spec === undefined) throw new Error(`missing spec: ${entry.id}`);
      const parsed = spec.resultSchema.safeParse(entry.valid);
      expect(parsed.success).toBe(true);
    }
  });

  test("rejects an invalid payload for every role", () => {
    for (const entry of cases) {
      const spec = builtinSubagentSpecs.find((item) => item.id === entry.id);
      if (spec === undefined) throw new Error(`missing spec: ${entry.id}`);
      expect(spec.resultSchema.safeParse(entry.invalid).success).toBe(false);
    }
  });
});
