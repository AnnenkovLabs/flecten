import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectTwin } from "../../src/app/twin";
import type { ModelProvider } from "../../src/providers/types";
import { emptyTwinState, TwinStateStore } from "../../src/twin/state";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "twin-training-lifecycle-"));
  let targetFailure = false;
  let duplicate = false;
  let beforeResponse = async (_signal: AbortSignal) => {};
  let requests = 0;
  const provider: ModelProvider = {
    id: "test",
    model: "test",
    async *stream(request, signal) {
      requests++;
      yield { type: "usage", input: 20, output: 10, cached: 0 };
      await beforeResponse(signal);
      const messages = request.messages[0]?.content ?? "";
      const sourceMessageId = messages.slice(
        messages.indexOf("source-flecten-"),
        messages.indexOf("source-flecten-") + 39,
      );
      const candidate = {
        kind: "preference",
        reaction: "like",
        strength: 2,
        voice: "Keep it inline.",
        summary: "Inline checkout",
        content: "Keep checkout inline.",
        appliesWhen: "Designing checkout",
        evidence: [{ sourceMessageId, quote: "Keep it inline." }],
      };
      yield {
        type: "text",
        delta: JSON.stringify({ candidates: duplicate ? [candidate, candidate] : [] }),
      };
      yield { type: "done", reason: "end" };
    },
  };
  const options = {
    cwd,
    home: cwd,
    secrets: () => [],
    target: () => {
      if (targetFailure) throw new Error("Choose a provider before learning.");
      return { provider, providerId: "test", model: "test", price: () => 0.01 };
    },
  };
  const twin = await projectTwin(options);
  cleanup.push(async () => {
    await twin.dispose();
    await rm(cwd, { recursive: true, force: true });
  });
  return {
    cwd,
    twin,
    options,
    setTargetFailure: (value: boolean) => {
      targetFailure = value;
    },
    setDuplicate: () => {
      duplicate = true;
    },
    beforeResponse: (callback: (signal: AbortSignal) => Promise<void>) => {
      beforeResponse = callback;
    },
    get requests() {
      return requests;
    },
    async source(name = "source", prompt = "Keep it inline.") {
      const directory = join(cwd, ".flecten/sessions", name);
      await mkdir(directory, { recursive: true });
      await Bun.write(
        join(directory, "events.jsonl"),
        JSON.stringify({ event: { type: "session.started", prompt } }),
      );
    },
    async settled() {
      // A failed atomic replacement on Windows retries for one second per save.
      // Wait beyond that recovery window before asserting the final training state.
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const snapshot = await twin.get();
        if (!["reading", "learning"].includes(snapshot.training.state)) return snapshot;
        await Bun.sleep(5);
      }
      throw new Error("Twin learning never settled");
    },
  };
}

test("A missing model never leaves an import locked and the next attempt can learn", async () => {
  const f = await fixture();
  await f.source();
  f.setTargetFailure(true);
  await expect(f.twin.train({ sourceIds: ["flecten"] })).rejects.toThrow("Choose a provider");
  expect((await f.twin.get()).training.state).not.toBe("learning");
  f.setTargetFailure(false);
  await f.twin.train({ sourceIds: ["flecten"] });
  expect((await f.settled()).training.state).toBe("ready");
  expect(f.requests).toBe(1);
});

test("Repeated imports batch all unread messages without skipping and avoid rerequesting processed messages", async () => {
  const f = await fixture();
  for (let index = 0; index < 125; index++) await f.source(`source-${index}`, `Decision ${index}`);
  await f.twin.train({ sourceIds: ["flecten"] });
  const first = await f.settled();
  expect(first.training.messages).toBe(125);
  expect(f.requests).toBe(2);
  await f.twin.train({ sourceIds: ["flecten"] });
  const second = await f.settled();
  expect(second.training.messages).toBe(0);
  expect(f.requests).toBe(2);
});

test("Duplicate proposed traits are saved once and remain deduplicated after restart", async () => {
  const f = await fixture();
  await f.source();
  f.setDuplicate();
  await f.twin.train({ sourceIds: ["flecten"] });
  const trained = await f.settled();
  expect(trained.training.state).toBe("ready");
  expect(trained.entries).toHaveLength(1);
  const reopened = await projectTwin(f.options);
  try {
    expect((await reopened.get()).entries).toHaveLength(1);
    await reopened.train({ sourceIds: ["flecten"] });
    await reopened.cancel();
    expect(f.requests).toBe(1);
  } finally {
    await reopened.dispose();
  }
});

test("A failed final save never publishes traits or consumes source messages", async () => {
  const f = await fixture();
  await f.source();
  f.setDuplicate();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.beforeResponse(async () => {
    entered.resolve();
    await release.promise;
  });
  await f.twin.train({ sourceIds: ["flecten"] });
  await entered.promise;
  const path = join(f.cwd, ".flecten/twin.json");
  await rm(path);
  await mkdir(path);
  release.resolve();
  const failed = await f.settled();
  expect(failed.training.state).toBe("error");
  expect(failed.entries).toHaveLength(0);
  expect(failed.training.usage).toMatchObject({ input: 20, output: 10, costUsd: 0.01 });
  await rm(path, { recursive: true });
  await f.twin.train({ sourceIds: ["flecten"] });
  const retried = await f.settled();
  expect(retried.training.state).toBe("ready");
  expect(retried.training.messages).toBe(1);
  expect(retried.entries).toHaveLength(1);
}, 15_000);

test("An interrupted on-disk import reopens as cancelled without losing existing traits", async () => {
  const f = await fixture();
  const state = emptyTwinState();
  state.training.state = "learning";
  await new TwinStateStore(f.cwd).save(state);
  const reopened = await projectTwin(f.options);
  try {
    expect((await reopened.get()).training).toMatchObject({ state: "cancelled", messages: 0 });
    expect((await reopened.get()).training.message).toContain("interrupted");
  } finally {
    await reopened.dispose();
  }
});

test("Cancel aborts the real learning request and keeps it retryable without replacing existing traits", async () => {
  const f = await fixture();
  await f.source();
  await f.twin.teach({
    summary: "Old trait",
    content: "Use plain labels.",
    appliesWhen: "Writing UI",
  });
  f.setDuplicate();
  const entered = Promise.withResolvers<AbortSignal>();
  f.beforeResponse(async (signal) => {
    entered.resolve(signal);
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
  });
  await f.twin.train({ sourceIds: ["flecten"] });
  const signal = await entered.promise;
  await expect(f.twin.train({ sourceIds: ["flecten"] })).rejects.toThrow("already learning");
  await expect(f.twin.scan()).rejects.toThrow("finish or cancel");
  const disabled = await f.twin.configure({ enabled: false });
  expect(signal.aborted).toBe(true);
  expect(disabled.training.state).toBe("cancelled");
  expect(disabled.enabled).toBe(false);
  const cancelled = await f.twin.cancel();
  expect(signal.aborted).toBe(true);
  expect(cancelled.training).toMatchObject({
    state: "cancelled",
    usage: { input: 20, output: 10 },
  });
  expect(cancelled.entries).toHaveLength(1);
  expect(cancelled.enabled).toBe(false);
  expect(cancelled.training.samples).toBeUndefined();
  f.beforeResponse(async () => {});
  await f.twin.train({ sourceIds: ["flecten"] });
  const retried = await f.settled();
  expect(retried.training).toMatchObject({ state: "ready", messages: 1 });
  expect(retried.entries).toHaveLength(2);
});
