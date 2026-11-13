import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadTracker } from "../../src/tools/util/read-tracker";
import { runWrite } from "../../src/tools/write/run";
import type { ThreadView as Thread } from "../../ui/src/lib/run/thread.svelte";
import "../helpers/svelte-runes";

const { ThreadView } = (await import("../../ui/src/lib/run/thread.svelte")) as {
  ThreadView: new () => Thread;
};

test("a pre-turn compaction notice and the core turn start share one rendered turn", () => {
  const thread = new ThreadView();
  thread.beginRun("Continue the long task");
  thread.note("layers", "Контекст сжат", "", "Earlier history");
  thread.turnStarted(1);
  thread.startTool({ id: "read-1", name: "read", args: { path: "README.md" } });
  const run = thread.items.find((item) => item.kind === "run");
  if (run?.kind !== "run") throw new Error("run missing");
  expect(run.summary.turns.map((turn) => turn.index)).toEqual([1]);
  expect(run.summary.turns[0]?.actions.map((action) => action.label)).toContain("Контекст сжат");
  thread.turnStarted(1);
  thread.reasoningDelta("Continue");
  expect(run.summary.turns.map((turn) => turn.index)).toEqual([1]);
});

test("repeating a real write preserves the last changed diff and later edits replace it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-thread-diff-"));
  const context = {
    sessionId: "s-diff",
    cwd,
    signal: new AbortController().signal,
    logDir: join(cwd, ".liquid/logs"),
    limits: {
      maxOutputBytes: 50000,
      maxOutputLines: 2000,
      bashTimeoutMs: 10000,
      readLimitLines: 2000,
    },
    reads: new ReadTracker(),
  };
  const thread = new ThreadView();
  thread.beginRun("Write a greeting");
  try {
    for (const [id, content] of [
      ["first", "Hello from the agent\n"],
      ["repeat", "Hello from the agent\n"],
      ["edit", "Goodbye from the agent\n"],
    ] as const) {
      const args = { path: "greeting.txt", content };
      const result = await runWrite(args, context);
      expect(result.ok).toBe(true);
      const call = { id, name: "write", args };
      thread.startTool(call);
      thread.finishTool(call, result);
      const diff = thread.changeFiles[0];
      expect(diff?.hunks.length).toBeGreaterThan(0);
      const added = diff?.hunks
        .flatMap((hunk) => hunk.lines)
        .filter((line) => line.kind === "add")
        .map((line) => line.text);
      expect(added).toEqual([id === "edit" ? "Goodbye from the agent" : "Hello from the agent"]);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
