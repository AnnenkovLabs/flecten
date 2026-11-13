import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EventJournal } from "../../src/app/event-journal";
import { autoResumable, markInterrupted } from "../../src/app/recovery";
import type { HarnessConfig } from "../../src/config/schema";
import type { QueueItem } from "../../src/core/queue/types";
import type { Event } from "../../src/core/types";
import { listSessions, recordSessionEvent } from "../../src/store/events";
import { sessionPaths } from "../../src/store/paths";
import { loadQueue, restoredQueue, saveQueue } from "../../src/store/queue";
import { appendEvent } from "../helpers/append-event";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-recovery-"));
  dirs.push(cwd);
  return cwd;
}

function started(sessionId: string, extra: { resumed?: boolean; queueId?: string } = {}): Event {
  return { type: "session.started", sessionId, provider: "p", model: "m", prompt: "go", ...extra };
}

function finished(sessionId: string): Event {
  return {
    type: "session.finished",
    sessionId,
    result: { stopReason: "done", usage: { input: 1, output: 1, cached: 0 } },
  } as Event;
}

async function log(cwd: string, event: Event): Promise<void> {
  await appendEvent(sessionPaths(cwd, event.sessionId ?? "").events, event);
  await recordSessionEvent(cwd, event);
}

function item(id: string, state: QueueItem["state"]): QueueItem {
  return { id, text: `message ${id}`, mode: "queue", createdAt: 1, state };
}

describe("crash recovery", () => {
  test("runs left running are marked interrupted once, with their resume history", async () => {
    const cwd = await workspace();
    await log(cwd, started("s_crashed"));
    await log(cwd, started("s_done"));
    await log(cwd, finished("s_done"));
    await log(cwd, started("s_again", { resumed: true }));

    const persisted: Event[] = [];
    const persist = async (event: Event) => {
      persisted.push(event);
      await log(cwd, event);
    };
    const runs = await markInterrupted(cwd, persist);
    const byId = Object.fromEntries(runs.map((run) => [run.sessionId, run.wasResumed]));
    expect(byId).toEqual({ s_crashed: false, s_again: true });
    expect(persisted.map((event) => event.type)).toEqual(["run.interrupted", "run.interrupted"]);

    const sessions = await listSessions(cwd);
    const crashed = sessions.find((session) => session.id === "s_crashed");
    expect(crashed).toMatchObject({ running: false, interrupted: true });
    expect(await markInterrupted(cwd, persist)).toEqual([]);
  });

  test("auto resume takes each crash once and can be turned off", () => {
    const runs = [
      { sessionId: "a", wasResumed: false },
      { sessionId: "b", wasResumed: true },
    ];
    expect(autoResumable({} as HarnessConfig, runs).map((run) => run.sessionId)).toEqual(["a"]);
    const off = { sessions: { autoResume: false } } as HarnessConfig;
    expect(autoResumable(off, runs)).toEqual([]);
  });
});

describe("queue on disk", () => {
  test("a restored queue drops delivered items and retries the one that was sending", async () => {
    const cwd = await workspace();
    await saveQueue(cwd, "s_q", {
      version: 1,
      items: [item("q1", "sending"), item("q2", "sending"), item("q3", "pending")],
    });
    await log(cwd, started("s_q", { queueId: "q1" }));

    const restored = await restoredQueue(cwd, "s_q");
    expect(restored?.items.map((entry) => [entry.id, entry.state])).toEqual([
      ["q2", "pending"],
      ["q3", "pending"],
    ]);
  });

  test("writes are atomic and an empty queue removes the file", async () => {
    const cwd = await workspace();
    await saveQueue(cwd, "s_q", { version: 1, items: [item("q1", "pending")] });
    const folder = dirname(sessionPaths(cwd, "s_q").queue);
    expect((await readdir(folder)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect((await loadQueue(cwd, "s_q"))?.items).toHaveLength(1);

    await saveQueue(cwd, "s_q", { version: 1, items: [] });
    expect(await Bun.file(sessionPaths(cwd, "s_q").queue).exists()).toBe(false);
  });

  test("an unreadable queue file is ignored instead of breaking the session", async () => {
    const cwd = await workspace();
    await saveQueue(cwd, "s_q", { version: 1, items: [item("q1", "pending")] });
    await writeFile(sessionPaths(cwd, "s_q").queue, "{ not json");
    expect(await loadQueue(cwd, "s_q")).toBeUndefined();
    expect(await restoredQueue(cwd, "s_q")).toBeUndefined();
  });
});

describe("event journal", () => {
  const delta = (sessionId: string, text: string) =>
    ({ type: "message.delta", sessionId, text }) as Event;

  test("a second window replays the live run with sequence numbers", () => {
    const journal = new EventJournal();
    journal.stamp(started("s_1"));
    journal.stamp(delta("s_1", "Hel"));
    const last = journal.stamp(delta("s_1", "lo"));
    const replay = journal.replay("s_1");
    expect(replay.running).toBe(true);
    expect(replay.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(replay.seq).toBe(last.seq);
  });

  test("deltas of a finished message are dropped and a finished run stops running", () => {
    const journal = new EventJournal();
    journal.stamp(started("s_1"));
    journal.stamp(delta("s_1", "text"));
    journal.stamp({ type: "message.finished", sessionId: "s_1" } as Event);
    journal.stamp(finished("s_1"));
    const replay = journal.replay("s_1");
    expect(replay.events.map((event) => event.type)).toEqual([
      "session.started",
      "message.finished",
      "session.finished",
    ]);
    expect(replay.running).toBe(false);
  });

  test("a new run of the session replaces the previous one", () => {
    const journal = new EventJournal();
    journal.stamp(started("s_1"));
    journal.stamp(finished("s_1"));
    journal.stamp(started("s_1"));
    expect(journal.replay("s_1").events).toHaveLength(1);
    expect(journal.replay("s_other")).toMatchObject({ events: [], running: false });
  });

  test("masks secrets before the live stream and the replay", () => {
    const journal = new EventJournal();
    journal.stamp(started("s_1"));
    const key = "AKIAABCDEFGHIJKLMNOP";
    const live = journal.stamp(delta("s_1", `export AWS_ACCESS_KEY_ID=${key}\n`));
    const [, replayed] = journal.replay("s_1").events;
    for (const event of [live, replayed]) {
      expect(JSON.stringify(event)).not.toContain(key);
      expect(JSON.stringify(event)).toContain("[redacted");
    }
  });
});
