import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationAcceptance } from "../../src/app/conversation-acceptance";
import { conversationBudget } from "../../src/app/conversation-budget";
import { createSingleSession } from "../../src/app/single-session";
import { WorkerRecovery } from "../../src/app/worker-recovery";
import { RunBudget } from "../../src/core/session/budget";
import { createSession, type SessionOptions } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

const limits = {
  maxOutputBytes: 5000,
  maxOutputLines: 100,
  bashTimeoutMs: 1000,
  readLimitLines: 100,
};
const receipt = { type: "usage" as const, input: 20, output: 10, cached: 0 };
const answer = [
  { type: "text" as const, delta: "<summary>Done.</summary>" },
  { type: "done" as const, reason: "end" as const },
];

test("one task charges multiple real session runs and stops a new request at the shared limit", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "task-ledger-"));
  const provider = scriptedProvider([
    [receipt, ...answer],
    [receipt, ...answer],
  ]);
  const ledger = new RunBudget({ maxTokens: 50 });
  const options: SessionOptions = {
    cwd,
    provider,
    providerId: "scripted",
    model: provider.model,
    tools: new ToolRegistry([], { limits }),
    system: "test",
    limits: { maxOutputBytes: 5000, maxOutputLines: 100, bashTimeoutMs: 1000, readLimitLines: 100 },
    maxOutputTokens: 200,
    context: { window: 10000, reserve: 500 },
    loop: { maxTurns: 2, continuations: 0, parallelTools: false },
    budgets: { maxTokens: 50 },
    taskBudget: ledger,
    externalBudgetExhausted: () => ledger.stopReason(),
    price: () => 0.01,
    logDir: (id) => join(cwd, id),
  };
  const first = createSession(options);
  const second = createSession({ ...options, role: "worker" });
  try {
    await first.send({ type: "run", prompt: "one" });
    await second.send({ type: "run", prompt: "two" });
    const result = (await first.send({ type: "run", prompt: "three" })) as RunResult;
    expect(provider.requests).toHaveLength(2);
    expect(result.stopReason).toBe("budget");
    expect(ledger.view().spent).toMatchObject({ tokens: 60, costUsd: 0.02 });
    const restored = conversationBudget(options, [
      { type: "task.budget", sessionId: "task", budget: ledger.view() },
    ]);
    expect(restored.exhausted()).toBe("tokens");
  } finally {
    await first.dispose();
    await second.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("an absent usage receipt becomes unknown in the actual session, including terminal failures", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "task-unknown-"));
  const provider = scriptedProvider([answer]);
  const events: Event[] = [];
  const session = createSession({
    cwd,
    provider,
    providerId: "scripted",
    model: provider.model,
    tools: new ToolRegistry([], { limits }),
    system: "test",
    limits: { maxOutputBytes: 5000, maxOutputLines: 100, bashTimeoutMs: 1000, readLimitLines: 100 },
    maxOutputTokens: 200,
    context: { window: 10000, reserve: 500 },
    loop: { maxTurns: 2, continuations: 0, parallelTools: false },
    price: () => 0,
    logDir: (id) => join(cwd, id),
  });
  session.subscribe((event) => events.push(event));
  try {
    const result = (await session.send({ type: "run", prompt: "one" })) as RunResult;
    expect(events.some((event) => event.type === "usage.unavailable")).toBe(true);
    expect(result.budget?.spent.costUsd).toBeUndefined();
    expect(result.budget?.accounting).toMatchObject({ status: "unavailable", missingRequests: 1 });
  } finally {
    await session.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("single-role chats persist task totals across restart and refuse requests past the cap", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "single-task-ledger-"));
  const provider = scriptedProvider([[receipt, ...answer]]);
  const events: Event[] = [];
  const options: SessionOptions = {
    cwd,
    provider,
    providerId: "scripted",
    model: provider.model,
    tools: new ToolRegistry([], { limits }),
    system: "test",
    limits,
    maxOutputTokens: 200,
    context: { window: 10000, reserve: 500 },
    loop: { maxTurns: 2, continuations: 0, parallelTools: false },
    budgets: { maxTokens: 25 },
    price: () => 0.02,
    logDir: (id) => join(cwd, id),
    onEvent: (event) => {
      events.push(event);
    },
  };
  const first = createSingleSession(options, []);
  try {
    await first.send({ type: "run", prompt: "first" });
    await first.flush();
    expect(events.findLast((event) => event.type === "task.budget")).toMatchObject({
      budget: { spent: { tokens: 30, costUsd: 0.02 } },
    });
    const restored = createSingleSession(options, [...events]);
    try {
      const result = (await restored.send({ type: "run", prompt: "continue" })) as RunResult;
      expect(result.stopReason).toBe("budget");
      expect(provider.requests).toHaveLength(1);
    } finally {
      await restored.dispose();
    }
  } finally {
    await first.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});

test("recovery preserves partial deliverables and uncertain operation identity without trusting narration", () => {
  const recovery = new WorkerRecovery();
  recovery.note({
    type: "tool.started",
    sessionId: "worker",
    call: { id: "train-1", name: "bash", args: { command: "run-training" } },
  });
  recovery.interrupted();
  recovery.note({
    type: "tool.finished",
    sessionId: "worker",
    call: {
      id: "checkpoint",
      name: "context",
      args: {
        op: "complete",
        summary: "A checked claim",
        evidence: ["source:42"],
        next: "Continue",
        result: "The actual answer with source:42.",
      },
    },
    result: { ok: true, output: "Saved" },
  });
  expect(recovery.view().uncertainEffects).toMatchObject([{ callId: "train-1", tool: "bash" }]);
  expect(recovery.partial).toBe("The actual answer with source:42.");
  expect(recovery.markdown()).toContain("train-1");
  const acceptance = new ConversationAcceptance((state) =>
    recovery.note({
      type: "worker.acceptance",
      sessionId: "task",
      acceptance: state,
    }),
  );
  acceptance.begin("A new assignment");
  expect(recovery.partial).toBeUndefined();
  expect(recovery.view().uncertainEffects).toMatchObject([{ callId: "train-1" }]);
});

test("recovery reconciles durable remote handles including a lost submission response", () => {
  const recovery = new WorkerRecovery();
  const id = "remote-01234567-89ab-cdef-0123-456789abcdef";
  const call = { id: "submit-1", name: "jobs", args: { op: "submit" } };
  recovery.note({
    type: "tool.finished",
    sessionId: "worker",
    call,
    result: {
      ok: false,
      output: "uncertain",
      data: {
        kind: "remote_job",
        id,
        state: "uncertain",
        remote: { host: "example.invalid", port: 22, cwd: "/work", python: "python3" },
      },
    },
  });
  expect(recovery.view().jobs).toMatchObject([
    { id, status: "uncertain", remote: { host: "example.invalid" } },
  ]);
  recovery.note({
    type: "tool.finished",
    sessionId: "worker",
    call,
    result: {
      ok: true,
      output: "running",
      data: {
        kind: "remote_job",
        job: {
          id,
          target: { host: "example.invalid", port: 22, cwd: "/work", python: "python3" },
          directory: "/work/.flecten-jobs/test",
          argv: ["python3", "train.py"],
          state: { id, argv: ["python3", "train.py"], cwd: "/work", status: "running" },
        },
      },
    },
  });
  expect(recovery.view().jobs).toMatchObject([
    { id, status: "running", command: "python3 train.py" },
  ]);
  expect(recovery.markdown()).toContain(id);
});
