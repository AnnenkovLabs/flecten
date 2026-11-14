import { expect, test } from "bun:test";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markInterrupted } from "../../src/app/recovery";
import { SessionLogs } from "../../src/app/session-logs";
import type { Event } from "../../src/core/types";
import { DurableEventLog, readTolerant } from "../../src/store/events/envelope";
import { listSessions, sessionIndexPath } from "../../src/store/events/index";
import { sessionPaths } from "../../src/store/paths";

function started(sessionId: string): Event {
  return { type: "session.started", sessionId, provider: "test", model: "m", prompt: "go" };
}

function finished(sessionId: string): Event {
  return {
    type: "session.finished",
    sessionId,
    result: {
      sessionId,
      pass: true,
      stopReason: "done",
      summary: "done",
      turns: 1,
      usage: { input: 1, output: 1, cached: 0 },
    },
  };
}

test("reopening an interrupted JSONL tail preserves every acknowledged append", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-tail-recovery-"));
  const id = "s_tail";
  const path = sessionPaths(cwd, id).events;
  try {
    const first = await DurableEventLog.open(path, id);
    await first.append(started(id));
    await first.close();
    await appendFile(path, '{"seq":2,"event":');
    const reopened = await DurableEventLog.open(path, id);
    try {
      await reopened.append({ type: "run.interrupted", sessionId: id, at: 1, reason: "crash" });
      await reopened.append({ type: "error", sessionId: id, code: "test", message: "next" });
    } finally {
      await reopened.close();
    }
    const { envelopes, corrupt } = await readTolerant(path);
    expect(envelopes.map(({ event }) => event.type)).toEqual([
      "session.started",
      "run.interrupted",
      "error",
    ]);
    expect(envelopes.map(({ seq }) => seq)).toEqual([1, 2, 3]);
    expect(corrupt).toHaveLength(1);

    // A complete event without its final newline must survive reopening too.
    const content = await readFile(path, "utf8");
    await writeFile(path, content.slice(0, -1));
    const completeTail = await DurableEventLog.open(path, id);
    await completeTail.append(finished(id));
    await completeTail.close();
    expect((await readTolerant(path)).envelopes.map(({ seq }) => seq)).toEqual([1, 2, 3, 4]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("index rebuild preserves the latest run lifecycle and crash recovery", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-index-recovery-"));
  const logs = new SessionLogs(cwd, () => []);
  try {
    await logs.persist(started("s_crashed"));
    await logs.persist(started("s_done"));
    await logs.persist(finished("s_done"));
    await logs.persist(started("s_restarted"));
    await logs.persist(finished("s_restarted"));
    await logs.persist(started("s_restarted"));
    await logs.persist(started("s_interrupted"));
    await logs.persist({
      type: "run.interrupted",
      sessionId: "s_interrupted",
      at: 1,
      reason: "previous crash",
    });
    await logs.closeAll();
    await writeFile(sessionIndexPath(cwd), "{broken index");

    const rebuilt = await listSessions(cwd);
    expect(rebuilt.find(({ id }) => id === "s_crashed")).toMatchObject({ running: true });
    expect(rebuilt.find(({ id }) => id === "s_done")).toMatchObject({
      running: false,
      stopReason: "done",
    });
    const restarted = rebuilt.find(({ id }) => id === "s_restarted");
    expect(restarted).toMatchObject({ running: true });
    expect(restarted?.stopReason).toBeUndefined();
    expect(rebuilt.find(({ id }) => id === "s_interrupted")).toMatchObject({
      running: false,
      interrupted: true,
    });

    const recovered = await markInterrupted(cwd, (event) => logs.persist(event));
    expect(recovered.map(({ sessionId }) => sessionId).sort()).toEqual([
      "s_crashed",
      "s_restarted",
    ]);
    expect(await markInterrupted(cwd, (event) => logs.persist(event))).toEqual([]);
    expect(
      (await readTolerant(sessionPaths(cwd, "s_crashed").events)).envelopes.at(-1)?.event,
    ).toMatchObject({ type: "run.interrupted" });
  } finally {
    await logs.closeAll();
    await rm(cwd, { recursive: true, force: true });
  }
});
