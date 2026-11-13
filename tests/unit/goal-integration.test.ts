import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFailure } from "../../src/core/goal/retry";
import { GoalState } from "../../src/core/goal/state";
import { createSession, type SessionOptions } from "../../src/core/session/session";
import type { RunResult } from "../../src/core/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

type Provider = ReturnType<typeof scriptedProvider>;

function sessionOptions(
  provider: Provider,
  cwd: string,
  overrides: Partial<SessionOptions> = {},
): SessionOptions {
  return {
    cwd,
    provider,
    providerId: "scripted",
    model: "scripted-1",
    tools: new ToolRegistry(builtinTools(), { limits }),
    system: "test",
    limits,
    maxOutputTokens: 1000,
    context: { window: 100_000, reserve: 1000 },
    loop: { maxTurns: 8, continuations: 0, parallelTools: false },
    logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
    ...overrides,
  };
}

function todoAdd(id: string, content: string) {
  return { type: "tool_call" as const, id, name: "todo", args: { op: "add", content } };
}

function doneCall(id: string, summary: string, evidence: string[]) {
  return {
    type: "tool_call" as const,
    id,
    name: "done",
    args: { summary, evidence },
  };
}

describe("goal integration", () => {
  test("todo criteria drive continuation and completion marks the goal met", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-goal-"));
    try {
      const update = {
        type: "tool_call" as const,
        id: "complete-todo",
        name: "todo",
        args: { op: "update", id: "", status: "completed" },
      };
      const provider = scriptedProvider([
        [todoAdd("call-1", "ship goal integration"), { type: "done", reason: "tool_use" }],
        [
          { type: "text", delta: "working on it" },
          { type: "done", reason: "end" },
        ],
        [update, { type: "done", reason: "tool_use" }],
        [doneCall("call-2", "shipped", ["tests pass"]), { type: "done", reason: "tool_use" }],
      ]);
      const session = createSession(sessionOptions(provider, cwd));
      session.subscribe((event) => {
        if (event.type !== "tool.finished" || event.call.id !== "call-1") return;
        const data = event.result.data as { todos: Array<{ id: string }> };
        update.args.id = data.todos[0]?.id ?? "";
      });

      const result = (await session.send({ type: "run", prompt: "ship the goal" })) as RunResult;

      expect(result.stopReason).toBe("done");
      const continued = provider.requests[1]?.messages ?? [];
      expect(
        continued.some(
          (message) =>
            message.role === "user" &&
            message.content.includes("continue the remaining criteria") &&
            message.content.includes("ship goal integration"),
        ),
      ).toBe(true);

      const status = (await session.send({ type: "status" })) as {
        goal: {
          objective: string;
          status: string;
          remainingCriteria: string[];
          evidenceCount: number;
        };
      };
      expect(status.goal).toEqual({
        objective: "ship the goal",
        status: "met",
        remainingCriteria: [],
        evidenceCount: 3,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("todo results replace criteria and record completed items as evidence", () => {
    const goal = new GoalState({ id: "g", objective: "ship", criteria: [] });

    goal.applyTodos([
      { content: "write code", status: "pending" },
      { content: "run tests", status: "completed" },
    ]);

    expect(goal.criteria).toEqual(["write code"]);
    expect(goal.evidence).toEqual(["Completed todo: run tests"]);

    goal.applyTodos([{ content: "run tests", status: "completed" }]);

    expect(goal.criteria).toEqual([]);
    expect(goal.evidence).toEqual(["Completed todo: run tests"]);
  });

  test("the goal budget blocks the next turn", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-goal-budget-"));
    try {
      const provider = scriptedProvider([
        [todoAdd("call-1", "unfinished work"), { type: "done", reason: "tool_use" }],
        [
          { type: "text", delta: "should not run" },
          { type: "done", reason: "end" },
        ],
      ]);
      const session = createSession(sessionOptions(provider, cwd, { goal: { maxAttempts: 1 } }));

      const result = (await session.send({ type: "run", prompt: "do the work" })) as RunResult;

      expect(result.stopReason).toBe("end");
      expect(provider.requests).toHaveLength(1);
      const status = (await session.send({ type: "status" })) as {
        goal: { status: string; remainingCriteria: string[] };
      };
      expect(status.goal.status).toBe("blocked");
      expect(status.goal.remainingCriteria).toEqual(["unfinished work"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("repeated turns without progress trip the circuit breaker", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-goal-progress-"));
    try {
      const idle = [
        { type: "text" as const, delta: "still thinking" },
        { type: "done" as const, reason: "end" as const },
      ];
      const provider = scriptedProvider([
        [todoAdd("call-1", "finish the task"), { type: "done", reason: "tool_use" }],
        idle,
        idle,
        idle,
      ]);
      const session = createSession(sessionOptions(provider, cwd));

      const result = (await session.send({ type: "run", prompt: "finish it" })) as RunResult;

      expect(result.stopReason).toBe("end");
      expect(provider.requests).toHaveLength(4);
      const status = (await session.send({ type: "status" })) as {
        goal: { status: string; remainingCriteria: string[] };
      };
      expect(status.goal.status).toBe("blocked");
      expect(status.goal.remainingCriteria).toEqual(["finish the task"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("session status exposes objective, status, remaining criteria and evidence count", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-goal-status-"));
    try {
      const provider = scriptedProvider([
        [
          { type: "text", delta: "plain answer" },
          { type: "done", reason: "end" },
        ],
      ]);
      const session = createSession(sessionOptions(provider, cwd));

      await session.send({ type: "run", prompt: "plain task" });

      const status = (await session.send({ type: "status" })) as {
        goal: Record<string, unknown>;
      };
      expect(Object.keys(status.goal).sort()).toEqual([
        "evidenceCount",
        "objective",
        "remainingCriteria",
        "status",
      ]);
      expect(status.goal).toEqual({
        objective: "plain task",
        status: "active",
        remainingCriteria: [],
        evidenceCount: 0,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("rate limits are classified by status, not by matching the error body", () => {
    expect(classifyFailure({ status: 429, message: "daily limit reached" })).toMatchObject({
      kind: "rate_limit",
    });
    expect(classifyFailure({ status: 400, message: "429 rate limit exceeded" })).toMatchObject({
      kind: "bad_request",
    });
    expect(classifyFailure({ kind: "quota_5h", status: 429, message: "anything" }).kind).toBe(
      "quota_5h",
    );
  });

  test("goal integration sources do not use regular expressions", async () => {
    const files = ["../../src/core/goal/state.ts", "../../src/core/loop/loop.ts"];
    const banned = ["RegExp", ".match(", ".test(", ".exec("];
    for (const file of files) {
      const source = await Bun.file(new URL(file, import.meta.url)).text();
      for (const token of banned) {
        expect(source).not.toContain(token);
      }
    }
  });
});
