import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../../src/config/defaults";
import { GoalState } from "../../src/core/goal/state";
import { runLoop } from "../../src/core/loop/loop";
import type { LoopEvent, LoopOptions } from "../../src/core/loop/types";
import { mapLoopEvent } from "../../src/core/session/loop-events";
import { replayMessages } from "../../src/store/events/replay";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { scriptedProvider } from "../helpers/fake-provider";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function options(provider: LoopOptions["provider"]): Promise<LoopOptions> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-completion-contract-"));
  dirs.push(cwd);
  const limits = defaultConfig().tools;
  return {
    provider,
    tools: new ToolRegistry(builtinTools(), { limits }),
    system: "test",
    signal: new AbortController().signal,
    emit: () => undefined,
    maxTurns: 2,
    maxTokens: 1000,
    contextWindow: 100_000,
    reserveTokens: 1000,
    continuations: 0,
    parallelTools: true,
    goal: new GoalState({
      id: "goal",
      objective: "Fix and check",
      criteria: ["Run the required check"],
    }),
    toolContext: {
      cwd,
      sessionId: "test",
      logDir: join(cwd, "logs"),
      reads: new ReadTracker(),
      limits,
    },
  };
}

test("done cannot override pending typed work", async () => {
  const provider = scriptedProvider([
    [
      {
        type: "tool_call",
        id: "premature",
        name: "done",
        args: { summary: "Finished", evidence: ["I think it works"] },
      },
      { type: "done", reason: "tool_use" },
    ],
    [
      { type: "text", delta: "Still blocked on the required check" },
      { type: "done", reason: "end" },
    ],
  ]);
  const result = await runLoop("Fix and check", await options(provider));
  expect(result.done).toBeUndefined();
  expect(result.messages.find((message) => message.role === "tool")).toMatchObject({
    isError: true,
  });
  expect(result.messages.find((message) => message.role === "tool")?.content).toContain(
    "Cannot finish while work remains",
  );
});

test("a trailing summary cannot override pending typed work", async () => {
  const provider = scriptedProvider([
    [
      { type: "text", delta: "Progress\n<summary><p>Finished</p></summary>" },
      { type: "done", reason: "end" },
    ],
    [
      { type: "text", delta: "Need the remaining check" },
      { type: "done", reason: "end" },
    ],
  ]);
  const events: LoopEvent[] = [];
  const opts = await options(provider);
  opts.emit = (event) => events.push(event);
  const result = await runLoop("Fix and check", opts);
  expect(result.done).toBeUndefined();
  expect(result.stopReason).not.toBe("done");
  const replayed = replayMessages(
    events.map((event, index) => ({ seq: index + 1, event: mapLoopEvent(event, "test") })),
  );
  expect(replayed.messages.find((message) => message.role === "assistant")).toEqual(
    result.messages.find((message) => message.role === "assistant"),
  );
});

test("completion is rejected in a mixed tool batch", async () => {
  const provider = scriptedProvider([
    [
      { type: "tool_call", id: "discover", name: "glob", args: { pattern: "*.ts" } },
      {
        type: "tool_call",
        id: "finish",
        name: "done",
        args: { summary: "Finished", evidence: ["All good"] },
      },
      { type: "done", reason: "tool_use" },
    ],
    [
      { type: "text", delta: "Observed the result" },
      { type: "done", reason: "end" },
    ],
  ]);
  const opts = await options(provider);
  delete opts.goal;
  const result = await runLoop("Inspect", opts);
  const finish = result.messages.find(
    (message) => message.role === "tool" && message.name === "done",
  );
  expect(finish).toMatchObject({ isError: true });
  expect(finish?.content).toContain("Call done alone");
  expect(result.done).toBeUndefined();
});

test("conversation accepts Markdown without forcing a summary, and still accepts a final HTML summary", async () => {
  for (const final of [false, true]) {
    const provider = scriptedProvider([
      [
        {
          type: "text",
          delta: final ? "<summary><p>Verified</p></summary>" : "Running the checks.",
        },
        { type: "done", reason: "end" },
      ],
    ]);
    const opts = await options(provider);
    delete opts.goal;
    opts.responseFormat = "conversation";
    const result = await runLoop("Check", opts);
    expect(provider.requests).toHaveLength(1);
    expect(result.turns).toBe(1);
    expect(result.stopReason).toBe(final ? "done" : "end");
    expect(result.summary).toBe(final ? "<p>Verified</p>" : "Running the checks.");
  }
});
