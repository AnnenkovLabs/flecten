import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunBudget } from "../../src/core/session/budget";
import { createSession, type SessionOptions } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import type { ModelProvider } from "../../src/providers/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function options(
  provider: ModelProvider,
  overrides: Partial<SessionOptions>,
): Promise<SessionOptions> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-budget-"));
  dirs.push(cwd);
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

const todo = (id: string) => ({
  type: "tool_call" as const,
  id,
  name: "todo",
  args: { op: "add", content: `item ${id}` },
});

describe("run budget", () => {
  test("tokens and cost are checked before the next request", () => {
    let now = 0;
    const budget = new RunBudget(
      { maxTokens: 100, maxCostUsd: 1 },
      (usage) => (usage.input + usage.output) / 100,
      () => now,
    );
    expect(budget.hasLimits()).toBe(true);
    budget.add({ input: 40, output: 20, cached: 0 });
    expect(budget.exhausted()).toBeUndefined();
    expect(budget.view().remaining).toEqual({ tokens: 40, costUsd: 0.4 });
    now = 5_000;
    budget.add({ input: 30, output: 10, cached: 0 });
    expect(budget.exhausted()).toBe("tokens");
    expect(budget.reason("tokens")).toContain("100 из 100 токенов");
    expect(budget.view().spent.wallClockMs).toBe(5_000);
  });

  test("without a price the cost limit never trips", () => {
    const budget = new RunBudget({ maxCostUsd: 0.01 });
    budget.add({ input: 1_000_000, output: 1_000_000, cached: 0 });
    expect(budget.exhausted()).toBeUndefined();
    expect(budget.view().spent.costUsd).toBeUndefined();
  });

  test("the wall clock fires even while nothing else happens", async () => {
    const budget = new RunBudget({ maxWallClockMs: 20 });
    let fired = false;
    const disarm = budget.arm(() => {
      fired = true;
    });
    await Bun.sleep(60);
    disarm();
    expect(fired).toBe(true);
    expect(budget.exhausted()).toBe("wall_clock");
  });

  test("a session stops at the token limit instead of sending the next request", async () => {
    const provider = scriptedProvider([
      [
        todo("call-1"),
        { type: "usage", input: 70, output: 30, cached: 0 },
        { type: "done", reason: "tool_use" },
      ],
      [
        { type: "text", delta: "should not run" },
        { type: "done", reason: "end" },
      ],
    ]);
    const events: Event[] = [];
    const session = createSession(await options(provider, { budgets: { maxTokens: 50 } }));
    session.subscribe((event) => events.push(event));
    const result = (await session.send({ type: "run", prompt: "work" })) as RunResult;

    expect(provider.requests).toHaveLength(1);
    expect(result.stopReason).toBe("budget");
    expect(result.budget?.exceeded).toBe("tokens");
    expect(events.some((event) => event.type === "budget")).toBe(true);
  });

  test("the wall-clock limit aborts a request that hangs", async () => {
    const hanging: ModelProvider = {
      id: "hanging",
      model: "hanging-1",
      async *stream(_request, signal) {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        yield { type: "done", reason: "end" };
      },
    };
    const session = createSession(await options(hanging, { budgets: { maxWallClockMs: 50 } }));
    const started = Date.now();
    const result = (await session.send({ type: "run", prompt: "hang" })) as RunResult;
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.stopReason).toBe("budget");
    expect(result.budget?.exceeded).toBe("wall_clock");
  });
});
