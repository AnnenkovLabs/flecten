import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TwinActivityEvent } from "../../shared/twin-activity";
import { ConversationTwin } from "../../src/app/conversation-twin";
import { projectTwin } from "../../src/app/twin";
import type { ModelProvider } from "../../src/providers/types";
import { ToolRegistry } from "../../src/tools/registry";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function fixture(hold = false) {
  const cwd = await mkdtemp(join(tmpdir(), "twin-runtime-state-"));
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const provider: ModelProvider = {
    id: "test",
    model: "test",
    async *stream() {
      started.resolve();
      if (hold) await release.promise;
      yield { type: "usage", input: 12, output: 3, cached: 0 };
      yield {
        type: "text",
        delta: JSON.stringify({
          verdict: "revise",
          voice: "Keep one screen.",
          instructions: "Remove registration.",
          entryIds: [],
          emotion: "calm",
        }),
      };
      yield { type: "done", reason: "end" };
    },
  };
  const options = {
    cwd,
    home: cwd,
    secrets: () => [],
    target: () => ({ provider, providerId: "test", model: "test", price: () => 0.001 }),
  };
  const port = await projectTwin(options);
  cleanup.push(async () => {
    release.resolve();
    await port.dispose();
    await rm(cwd, { recursive: true, force: true });
  });
  return { cwd, options, port, provider, started, release };
}

const lesson = (index: number) => ({
  summary: `Preference ${index}`,
  content: `Keep preference ${index}.`,
  appliesWhen: "Building this project",
});

test("Repeating a manual correction remains idempotent when the Twin profile is full", async () => {
  const f = await fixture();
  for (let index = 0; index < 64; index++) await f.port.teach(lesson(index));
  const repeated = await f.port.teach(lesson(0));
  expect(repeated.entries).toHaveLength(64);
  expect(repeated.entries[0]?.revision).toBe(1);
  const reopened = await projectTwin(f.options);
  cleanup.push(() => reopened.dispose());
  expect((await reopened.get()).entries).toEqual(repeated.entries);
});

test("A correction with a maximum-length path stays valid and survives reopening Twin", async () => {
  const f = await fixture();
  const learned = await f.port.teach({ ...lesson(0), path: "a".repeat(1024) });
  expect(learned.entries).toHaveLength(1);
  expect(learned.entries[0]?.evidence[0]?.reference.length).toBeLessThanOrEqual(1024);
  const reopened = await projectTwin(f.options);
  cleanup.push(() => reopened.dispose());
  expect((await reopened.get()).entries).toEqual(learned.entries);
});

test("Failed profile writes preserve the last confirmed traits and revisions in memory", async () => {
  const f = await fixture();
  const before = await f.port.teach(lesson(0));
  const entry = before.entries[0];
  if (!entry) throw new Error("Missing Twin trait");
  const path = join(f.cwd, ".flecten/twin.json");
  await rename(path, `${path}.backup`);
  await mkdir(path);
  await expect(f.port.teach(lesson(1))).rejects.toThrow();
  expect((await f.port.get()).entries).toEqual(before.entries);
  await expect(
    f.port.update({
      id: entry.id,
      expectedRevision: 1,
      edits: { ...lesson(2), reaction: "like", strength: 1, voice: "I prefer this." },
    }),
  ).rejects.toThrow();
  expect((await f.port.get()).entries).toEqual(before.entries);
  await expect(f.port.forget({ id: entry.id, expectedRevision: 1 })).rejects.toThrow();
  expect((await f.port.get()).entries).toEqual(before.entries);
});

test.each(["disable", "new instruction during status", "stop during status"])(
  "Twin retires an in-flight decision on %s and retains its observed usage",
  async (action) => {
    const f = await fixture(true);
    await f.port.configure({ enabled: true });
    const checking = Promise.withResolvers<void>();
    const checked = Promise.withResolvers<void>();
    const originalGet = f.port.get;
    let reads = 0;
    f.port.get = async () => {
      reads++;
      const snapshot = await originalGet();
      if (action !== "disable" && reads === 2) {
        checking.resolve();
        await checked.promise;
      }
      return snapshot;
    };
    const limits = {
      maxOutputBytes: 1000,
      maxOutputLines: 100,
      bashTimeoutMs: 1000,
      readLimitLines: 100,
    };
    const events: TwinActivityEvent[] = [];
    const twin = new ConversationTwin(
      f.port,
      {
        cwd: f.cwd,
        sessionId: "runtime-state",
        provider: f.provider,
        providerId: "test",
        model: "test",
        tools: new ToolRegistry([], { limits }),
        system: "test",
        limits,
        maxOutputTokens: 100,
        context: { window: 1000, reserve: 100 },
        loop: { maxTurns: 3, continuations: 0, parallelTools: false },
        budgets: { maxTokens: 100, maxCostUsd: 0.01 },
        logDir: () => join(f.cwd, "logs"),
      },
      (event) => events.push(event),
    );
    twin.user("One screen, no registration.");
    twin.begin("Build checkout.");
    const pending = twin.decide("prepare");
    await f.started.promise;
    if (action === "disable") await f.port.configure({ enabled: false });
    f.release.resolve();
    if (action !== "disable") {
      await checking.promise;
      if (action === "new instruction during status") twin.user("New human instruction");
      else twin.cancel();
      checked.resolve();
    }
    expect(await pending).toBeUndefined();
    expect(events.at(-1)?.activity).toMatchObject({
      state: "cancelled",
      usage: { input: 12, output: 3, cached: 0, costUsd: 0.001 },
    });
    expect(twin.remaining()?.maxTokens).toBe(85);
    if (action === "disable") {
      expect(await twin.decide("final")).toBeUndefined();
      expect(events.at(-1)?.activity.state).toBe("disabled");
    }
  },
);
