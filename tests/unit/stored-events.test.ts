import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Event, EventType } from "../../src/core/types";
import { DurableEventLog } from "../../src/store/events/envelope";
import { readSession, type StoredEventType } from "../../src/store/events/read";
import { sessionPaths } from "../../src/store/paths";

// tsc fails here when the sidecar persists an event the reader has no schema for:
// such an event would be written on every run and silently dropped on reopen.
type Unread = Exclude<EventType, "provider.retry" | StoredEventType>;
const everyStoredEventReads: [Unread] extends [never] ? true : Unread = true;

describe("stored events", () => {
  test("every event the sidecar writes comes back when a task is reopened", async () => {
    expect(everyStoredEventReads).toBe(true);
    const cwd = await mkdtemp(join(tmpdir(), "liquid-stored-"));
    try {
      const id = "s-stored";
      const events: Event[] = [
        { type: "session.started", sessionId: id, prompt: "x", provider: "p", model: "m" },
        {
          type: "usage",
          sessionId: id,
          provider: "p",
          model: "m",
          usage: { input: 100, output: 20, cached: 50, reasoning: 10, cacheWrite: 30 },
        },
        {
          type: "context.usage",
          sessionId: id,
          used: 41_200,
          window: 200_000,
          reserve: 16_000,
          source: "provider",
        },
        {
          type: "model.fallback",
          sessionId: id,
          provider: "backup",
          model: "b-model",
          reason: "rate_limit",
        },
        {
          type: "run.interrupted",
          sessionId: id,
          at: 1_762_214_400_000,
          reason: "sidecar stopped",
        },
      ];
      const path = sessionPaths(cwd, id).events;
      await mkdir(dirname(path), { recursive: true });
      const log = await DurableEventLog.open(path, id);
      for (const event of events) await log.append(event);
      await log.close();
      expect(await readSession(cwd, id)).toEqual(events);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
