import { afterEach, expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { subagentChildRunner } from "../../src/app/subagent-child";
import { defaultConfig } from "../../src/config/defaults";
import { exploreSubagent, implementSubagent } from "../../src/core/subagents/builtin";
import { createSubagentRuntime } from "../../src/core/subagents/factory";
import { PermissionEngine } from "../../src/security/permissions";
import { CheckpointStore } from "../../src/store/checkpoints";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import type { TaskToolContext } from "../../src/tools/task/run";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { scriptedProvider } from "../helpers/fake-provider";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-prompt-contract-"));
  dirs.push(cwd);
  return cwd;
}

test("a plain Ready response is formatted without replaying the assignment", async () => {
  const cwd = await workspace();
  const config = defaultConfig();
  const provider = scriptedProvider([
    [
      { type: "text", delta: "Ready." },
      { type: "usage", input: 10, output: 2, cached: 0 },
      { type: "done", reason: "end" },
    ],
    [
      {
        type: "tool_call",
        id: "report",
        name: "submit_report",
        args: { summary: "Ready.", files: [], findings: [], openQuestions: [] },
      },
      { type: "usage", input: 12, output: 6, cached: 0 },
      { type: "done", reason: "tool_use" },
    ],
  ]);
  const tools = new ToolRegistry(builtinTools(), { limits: config.tools });
  const run = subagentChildRunner({
    cwd,
    config: () => config,
    provider: () => provider,
    tools: () => tools,
    trusted: () => false,
    checkpoints: new CheckpointStore({ cwd }),
    shellCheckpoints: () => undefined,
    sandbox: () => undefined,
    osSandbox: () => undefined,
  });
  const result = await run({
    spec: exploreSubagent,
    systemPrompt: exploreSubagent.systemPrompt,
    messages: [{ role: "user", content: "Reply when ready. Do not inspect or change files." }],
    allowedTools: exploreSubagent.allowedTools,
    permissions: exploreSubagent.permissions,
    budget: exploreSubagent.budget,
    signal: new AbortController().signal,
  });
  expect(result.error).toBeUndefined();
  expect(JSON.parse(result.text)).toEqual({
    summary: "Ready.",
    files: [],
    findings: [],
    openQuestions: [],
  });
  expect(provider.requests).toHaveLength(2);
  expect(provider.requests[1]?.tools.map((tool) => tool.name)).toEqual(["submit_report"]);
  expect(provider.requests[1]?.toolChoice).toBe("required");
  expect(result.usage.input).toBe(22);
  expect(result.turns).toBe(2);
});

test("a real child inherits repo rules, sees its result schema and returns JSON after tools", async () => {
  const cwd = await workspace();
  await writeFile(join(cwd, "AGENTS.md"), "# Rules\nPreserve the project-specific public API.");
  await writeFile(join(cwd, "entry.ts"), "export const port = 8080;\n");
  const provider = scriptedProvider([
    [
      { type: "tool_call", id: "read-entry", name: "read", args: { path: "entry.ts" } },
      { type: "done", reason: "tool_use" },
    ],
    [
      {
        type: "text",
        delta: JSON.stringify({
          summary: "Found the entry",
          files: ["entry.ts"],
          findings: ["port is 8080"],
          openQuestions: [],
        }),
      },
      { type: "done", reason: "end" },
    ],
  ]);
  const config = defaultConfig();
  const tools = new ToolRegistry(builtinTools(), { limits: config.tools });
  const checkpoints = new CheckpointStore({ cwd });
  const run = subagentChildRunner({
    cwd,
    config: () => config,
    provider: () => provider,
    tools: () => tools,
    trusted: () => false,
    checkpoints,
    shellCheckpoints: () => undefined,
    sandbox: () => undefined,
    osSandbox: () => undefined,
  });
  const result = await run({
    spec: exploreSubagent,
    systemPrompt: exploreSubagent.systemPrompt,
    messages: [{ role: "user", content: "Find the port in entry.ts" }],
    allowedTools: exploreSubagent.allowedTools,
    permissions: exploreSubagent.permissions,
    budget: exploreSubagent.budget,
    signal: new AbortController().signal,
  });
  expect(result.error).toBeUndefined();
  expect(result.turns).toBe(2);
  expect(provider.requests).toHaveLength(2);
  expect(JSON.parse(result.text).findings).toEqual(["port is 8080"]);
  const request = provider.requests[0];
  expect(request?.system).toContain("Preserve the project-specific public API.");
  expect(request?.system).toContain('"openQuestions"');
  expect(request?.system).toContain("# Explore role");
  expect(request?.system).not.toContain("## HTML summary");
  expect(request?.tools.map((tool) => tool.name).sort()).toEqual(
    [...exploreSubagent.allowedTools].sort(),
  );
  expect(
    provider.requests[1]?.messages.some(
      (message) => message.role === "tool" && message.content.includes("8080"),
    ),
  ).toBe(true);
});

test("implement has native discovery and job lifecycle tools", () => {
  expect(implementSubagent.allowedTools).toEqual(expect.arrayContaining(["grep", "glob", "jobs"]));
});

test.each(["invalid", "turn-budget", "cancel"] as const)(
  "report formatting preserves failure and limits: %s",
  async (scenario) => {
    const cwd = await workspace();
    const config = defaultConfig();
    const controller = new AbortController();
    const provider = scriptedProvider([
      [
        { type: "text", delta: "Ready." },
        { type: "done", reason: "end" },
      ],
      [
        { type: "tool_call", id: "invalid", name: "submit_report", args: { summary: "Ready." } },
        { type: "done", reason: "tool_use" },
      ],
    ]);
    const tools = new ToolRegistry(builtinTools(), { limits: config.tools });
    const run = subagentChildRunner({
      cwd,
      config: () => config,
      provider: () => provider,
      tools: () => tools,
      trusted: () => false,
      checkpoints: new CheckpointStore({ cwd }),
      shellCheckpoints: () => undefined,
      sandbox: () => undefined,
      osSandbox: () => undefined,
    });
    const result = await run({
      spec: exploreSubagent,
      systemPrompt: exploreSubagent.systemPrompt,
      messages: [{ role: "user", content: "Acknowledge readiness" }],
      allowedTools: exploreSubagent.allowedTools,
      permissions: exploreSubagent.permissions,
      budget: { ...exploreSubagent.budget, maxTurns: scenario === "turn-budget" ? 1 : 12 },
      signal: controller.signal,
      onEvent: (event) => {
        if (scenario === "cancel" && event.type === "session.finished") controller.abort();
      },
    });
    expect(result.error).toBeDefined();
    expect(provider.requests).toHaveLength(scenario === "invalid" ? 2 : 1);
    if (scenario === "invalid") expect(result.error).toContain("files");
  },
);

test.each(["deny", "ask", "skill"] as const)(
  "a real task child cannot widen its parent's %s restriction",
  async (restriction) => {
    const cwd = await workspace();
    const config = defaultConfig();
    const provider = scriptedProvider([
      [
        {
          type: "tool_call",
          id: "child-write",
          name: "write",
          args: { path: "forbidden.txt", content: "unsafe" },
        },
        { type: "done", reason: "tool_use" },
      ],
      [
        { type: "text", delta: JSON.stringify({ summary: "Restricted correctly" }) },
        { type: "done", reason: "end" },
      ],
    ]);
    const tools = new ToolRegistry(builtinTools(), {
      limits: config.tools,
      authorize: (tool) =>
        restriction === "skill" && tool.name === "write"
          ? "Active parent skill denies write"
          : undefined,
    });
    const runChild = subagentChildRunner({
      cwd,
      config: () => config,
      provider: () => provider,
      tools: () => tools,
      trusted: () => false,
      checkpoints: new CheckpointStore({ cwd }),
      shellCheckpoints: () => undefined,
      sandbox: () => undefined,
      osSandbox: () => undefined,
    });
    const spec = {
      id: "writer",
      name: "Writer",
      description: "Write one file",
      systemPrompt: "Write then return JSON.",
      allowedTools: ["write"],
      permissions: [{ action: "write" as const, policy: "allow" as const }],
      budget: { maxTurns: 3, maxTokens: 1000 },
      resultSchema: z.object({ summary: z.string() }),
    };
    const runtime = createSubagentRuntime({ specs: [spec], toolRegistry: tools, runChild });
    const permissions = new PermissionEngine({
      rules: [{ action: "write", policy: restriction === "skill" ? "allow" : restriction }],
    });
    const context: TaskToolContext = {
      cwd,
      sessionId: "parent",
      signal: new AbortController().signal,
      logDir: join(cwd, ".liquid/logs"),
      limits: config.tools,
      reads: new ReadTracker(),
      permissions,
      subagentRunnerFactory: runtime.factory,
    };
    const result = await tools.run(
      { id: "parent-task", name: "task", args: { agent: "writer", prompt: "Write forbidden.txt" } },
      context,
    );
    expect(result.ok).toBe(true);
    expect(
      await access(join(cwd, "forbidden.txt")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(permissions.pending()).toEqual([]);
    const messages =
      provider.requests[1]?.messages.filter((message) => message.role === "tool") ?? [];
    expect(
      messages.some((message) =>
        message.content.includes(
          restriction === "skill" ? "Active parent skill" : "Parent permission",
        ),
      ),
    ).toBe(true);
  },
);
