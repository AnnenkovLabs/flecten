import { describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EventJournal } from "../../src/app/event-journal";
import { SessionStorage } from "../../src/app/session-storage";
import { Services } from "../../src/core/services/registry";
import type { Event } from "../../src/core/types";
import { withEnvelope } from "../../src/store/events/envelope";
import { readSession } from "../../src/store/events/read";
import { sessionPaths } from "../../src/store/paths";

const sessionId = "s_timestamps";
const start = Date.parse("2026-11-14T01:40:00.000Z");
const events: [Event, Event] = [
  { type: "session.started", sessionId, provider: "test", model: "test", prompt: "go" },
  {
    type: "session.finished",
    sessionId,
    result: {
      sessionId,
      pass: false,
      stopReason: "end",
      summary: "done",
      turns: 1,
      usage: { input: 1, output: 1, cached: 0 },
    },
  },
];

describe("event timing metadata", () => {
  test("replay retains the original start and completion times", () => {
    const now = spyOn(Date, "now").mockReturnValue(start);
    try {
      const journal = new EventJournal();
      journal.stamp(events[0]);
      now.mockReturnValue(start + 45_000);
      journal.stamp(events[1]);
      now.mockReturnValue(start + 90_000);

      expect(journal.replay(sessionId).events).toEqual([
        expect.objectContaining({ type: "session.started", timestamp: start }),
        expect.objectContaining({ type: "session.finished", timestamp: start + 45_000 }),
      ]);
    } finally {
      now.mockRestore();
    }
  });

  test("both durable read paths retain envelope times without inventing legacy times", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-event-times-"));
    const storage = new SessionStorage(
      cwd,
      () => [],
      () => new Services(() => []),
      async () => {},
    );
    try {
      const path = sessionPaths(cwd, sessionId).events;
      await mkdir(dirname(path), { recursive: true });
      const envelopes = events.map((event, index) =>
        withEnvelope(event, index + 1, sessionId, new Date(start + index * 45_000).toISOString()),
      );
      await writeFile(path, `${envelopes.map((item) => JSON.stringify(item)).join("\n")}\n`);

      for (const read of [() => storage.read(sessionId), () => readSession(cwd, sessionId)]) {
        expect(await read()).toEqual([
          { ...events[0], timestamp: start },
          { ...events[1], timestamp: start + 45_000 },
        ]);
      }

      await writeFile(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
      expect(await storage.read(sessionId)).toEqual(events);
      expect(await readSession(cwd, sessionId)).toEqual(events);
    } finally {
      await storage.closeAll();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
