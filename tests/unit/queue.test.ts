import { describe, expect, it } from "bun:test";
import { RunQueue } from "../../src/core/queue/queue";
import { SteeringController } from "../../src/core/queue/steering";
import type { QueueItem } from "../../src/core/queue/types";

function steerItem(id = "q_steer"): QueueItem {
  return {
    id,
    text: "steer now",
    mode: "steer",
    createdAt: 1,
    state: "pending",
  };
}

describe("run queue", () => {
  it("adds, edits and removes pending messages", () => {
    const queue = new RunQueue();
    const first = queue.add("first", "queue", ["/tmp/a.png"]);
    const second = queue.add("second");

    expect(first.id).not.toBe(second.id);
    expect(first.state).toBe("pending");
    expect(first.attachments).toEqual(["/tmp/a.png"]);
    expect(queue.list().map((item) => item.text)).toEqual(["first", "second"]);

    const edited = queue.edit(first.id, "first edited");
    expect(edited.text).toBe("first edited");
    expect(edited.createdAt).toBe(first.createdAt);
    expect(queue.list()[0]?.text).toBe("first edited");

    const removed = queue.remove(second.id);
    expect(removed.id).toBe(second.id);
    expect(queue.list().map((item) => item.id)).toEqual([first.id]);
    expect(() => queue.edit(second.id, "gone")).toThrow(/not found/);
    expect(() => queue.edit(first.id, "")).toThrow();
    expect(queue.list()[0]?.text).toBe("first edited");
  });

  it("rejects edits and removals that break delivery", () => {
    const queue = new RunQueue();
    const item = queue.add("busy");
    queue.markSending(item.id);

    expect(() => queue.edit(item.id, "late edit")).toThrow(/state sending/);
    expect(() => queue.remove(item.id)).toThrow(/state sending/);
    queue.markCancelled(item.id);
    expect(() => queue.markSent(item.id)).toThrow(/state cancelled/);
  });

  it("takes every queued message exactly once", () => {
    const queue = new RunQueue();
    const first = queue.add("one");
    const second = queue.add("two");

    const taken = queue.takeNext();
    expect(taken?.id).toBe(first.id);
    expect(taken?.state).toBe("sending");
    expect(queue.takeNext()?.id).toBe(second.id);
    expect(queue.takeNext()).toBeUndefined();
    expect(() => queue.markSending(first.id)).toThrow(/state sending/);
    expect(queue.markSent(first.id).state).toBe("sent");
  });

  it("keeps steer messages out of the queue drain", () => {
    const queue = new RunQueue();
    const queued = queue.add("after turn");
    const steer = queue.add("now", "steer");

    expect(queue.takeNext()?.id).toBe(queued.id);
    expect(queue.takeNext()).toBeUndefined();
    expect(queue.list().find((item) => item.id === steer.id)?.state).toBe("pending");
  });
});

describe("steering", () => {
  it("injects only at a boundary and never by the queue drain", () => {
    const queue = new RunQueue();
    const steering = new SteeringController();
    const steer = queue.add("steer now", "steer");
    const queued = queue.add("queued");

    expect(steering.push(steer)).toBe(true);
    expect(steering.hasPending()).toBe(true);
    expect(queue.takeNext()?.id).toBe(queued.id);
    expect(queue.takeNext()).toBeUndefined();

    const injected = steering.takeAtBoundary();
    expect(injected.map((item) => item.id)).toEqual([steer.id]);
    expect(steering.hasPending()).toBe(false);
    expect(steering.takeAtBoundary()).toEqual([]);
  });

  it("does not inject the same steer twice or accept a queued message", () => {
    const steering = new SteeringController();
    const item = steerItem();

    expect(steering.push(item)).toBe(true);
    expect(steering.push(item)).toBe(false);
    expect(steering.push({ ...item, id: "q_other" })).toBe(true);
    expect(steering.takeAtBoundary()).toHaveLength(2);
    expect(steering.push(item)).toBe(false);
    expect(steering.push({ ...item, mode: "queue" as const })).toBe(false);
    expect(steering.push({ ...item, state: "sent" as const })).toBe(false);
  });

  it("keeps a pending steer in sync with edits and cancellation", () => {
    const steering = new SteeringController();
    const item = steerItem();

    expect(steering.push(item)).toBe(true);
    expect(steering.push({ ...item, text: "edited" })).toBe(false);
    expect(steering.takeAtBoundary()[0]?.text).toBe("edited");

    steering.push({ ...item, id: "q_cancel" });
    expect(steering.push({ ...item, id: "q_cancel", state: "cancelled" })).toBe(false);
    expect(steering.hasPending()).toBe(false);
  });

  it("clears pending steering and its dedupe history", () => {
    const steering = new SteeringController();
    const item = steerItem();

    steering.push(item);
    steering.clear();
    expect(steering.hasPending()).toBe(false);
    expect(steering.push(item)).toBe(true);
  });
});

describe("queue persistence", () => {
  it("restores states without resending in-flight messages", () => {
    const queue = new RunQueue();
    const sent = queue.add("sent");
    queue.markSending(sent.id);
    queue.markSent(sent.id);
    const pending = queue.add("pending");
    const sending = queue.add("sending");
    queue.markSending(sending.id);
    const steer = queue.add("steer", "steer", ["/tmp/a.txt"]);

    const restored = RunQueue.restore(JSON.parse(JSON.stringify(queue.serialize())));
    expect(restored.list()).toEqual(queue.list().filter((item) => item.id !== sent.id));
    expect(restored.takeNext()?.id).toBe(pending.id);
    expect(restored.takeNext()).toBeUndefined();
    expect(restored.list().find((item) => item.id === steer.id)?.attachments).toEqual([
      "/tmp/a.txt",
    ]);
  });

  it("rejects an unknown serialized shape", () => {
    const item = new RunQueue().add("duplicate");
    expect(() => RunQueue.restore({ version: 2, items: [] })).toThrow();
    expect(() => RunQueue.restore({ version: 1, items: [{ id: "q_1" }] })).toThrow();
    expect(() => RunQueue.restore({ version: 1, items: [item, item] })).toThrow(/unique/);
  });
});
