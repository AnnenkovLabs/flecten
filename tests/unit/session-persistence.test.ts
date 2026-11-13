import { describe, expect, test } from "bun:test";
import { SessionPersistence } from "../../src/core/session/persistence";
import type { Event } from "../../src/core/types";

const STARTED: Event = {
  type: "session.started",
  sessionId: "s_1",
  provider: "p",
  model: "m",
  prompt: "go",
  queueId: "q_1",
};

describe("session persistence", () => {
  test("persists a delivery event before removing its item from the durable queue", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: string[] = [];
    const persistence = new SessionPersistence(
      {
        onEvent: async () => {
          await barrier;
          writes.push("delivered");
        },
        saveQueue: async () => {
          writes.push("queue");
        },
      },
      () => {},
    );
    persistence.event(STARTED);
    const saved = persistence.queue("s_1", { version: 1, items: [] });
    await Bun.sleep(1);
    expect(writes).toEqual([]);
    release();
    await saved;
    expect(writes).toEqual(["delivered", "queue"]);
  });

  test("a failed event leaves the durable queue intact and reports the disk failure", async () => {
    const failures: unknown[] = [];
    let queueWrites = 0;
    const persistence = new SessionPersistence(
      {
        onEvent: async () => {
          throw new Error("disk full");
        },
        saveQueue: async () => {
          queueWrites += 1;
        },
      },
      (error) => failures.push(error),
    );
    persistence.event(STARTED);
    await expect(persistence.queue("s_1", { version: 1, items: [] })).rejects.toThrow("disk full");
    await expect(persistence.flush()).rejects.toThrow("disk full");
    expect(queueWrites).toBe(0);
    expect(failures).toHaveLength(1);
  });
});
