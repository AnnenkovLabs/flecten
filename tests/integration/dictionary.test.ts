import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DictionarySnapshotSchema } from "../../shared/dictionary";
import { createHandlers } from "../../src/app/server-handlers";
import { createAppService } from "../../src/app/service";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-dictionary-"));
  const requests: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(await request.json());
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "<complete>Ready.</complete>" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await Bun.write(
    join(cwd, "flecten.config.json"),
    JSON.stringify({
      useDefaults: false,
      conversation: { enabled: false },
      provider: "test",
      model: "test",
      catalog: { autoRefresh: false },
      skills: { sources: [] },
      checkpoints: { shell: false },
      providers: {
        test: {
          protocol: "openai-chat",
          baseUrl: server.url.href,
          models: { test: { context: 128000, output: 8192 } },
        },
      },
    }),
  );
  await mkdir(join(cwd, ".liquid/dictionary"), { recursive: true });
  const category = await Bun.file(
    new URL("../../src/dictionary/data/design.json", import.meta.url),
  ).json();
  await Bun.write(
    join(cwd, ".liquid/dictionary/public.json"),
    JSON.stringify({
      schemaVersion: 1,
      syncedAt: new Date().toISOString(),
      categories: [category],
    }),
  );
  const app = await createAppService(cwd);
  cleanups.push(async () => {
    await app.dispose();
    server.stop(true);
    await rm(cwd, { recursive: true, force: true });
  });
  return { app, cwd, requests, handlers: createHandlers(app, () => {}) };
}

test("dictionary commands persist a local override, deliver it to the real provider path and restore the public definition", async () => {
  const f = await fixture();
  const initial = DictionarySnapshotSchema.parse(
    (await f.handlers["dictionary.list"]({ type: "dictionary.list" }))?.dictionary,
  );
  const publicEntry = initial.entries.find((entry) => entry.term === "Liquid Glass");
  if (!publicEntry) throw new Error("Missing bundled Liquid Glass definition");
  const { source: _source, revision: _revision, ...entry } = publicEntry;
  entry.definition = "LOCAL_MEANING: Apple material with refraction and adaptive controls.";
  const saved = DictionarySnapshotSchema.parse(
    (
      await f.handlers["dictionary.save"]({
        type: "dictionary.save",
        entry,
        expectedRevision: 0,
      })
    )?.dictionary,
  );
  expect(saved.entries.filter((record) => record.id === entry.id)).toHaveLength(2);
  expect(
    saved.entries.find((record) => record.id === entry.id && record.source === "local"),
  ).toMatchObject({
    source: "local",
    revision: 1,
  });
  const prompt = "Сделай Liquid Glass";
  const events: { type: string; prompt?: string }[] = [];
  const off = f.app.session.subscribe((event) => events.push(event));
  await f.app.session.send({ type: "run", sessionId: "dictionary-chat", prompt });
  off();
  expect(events.find((event) => event.type === "session.started")?.prompt).toBe(prompt);
  expect(JSON.stringify(f.requests[0])).toContain("LOCAL_MEANING");
  const disk = await Bun.file(join(f.cwd, ".liquid/memory.json")).json();
  expect(disk.records[0].dictionary).toEqual(entry);
  await expect(
    f.handlers["dictionary.save"]({
      type: "dictionary.save",
      entry: { ...entry, definition: "Stale update" },
      expectedRevision: 0,
    }),
  ).rejects.toThrow("revision conflict");
  const forgotten = DictionarySnapshotSchema.parse(
    (
      await f.handlers["dictionary.forget"]({
        type: "dictionary.forget",
        id: entry.id,
        expectedRevision: 1,
      })
    )?.dictionary,
  );
  expect(forgotten.entries.find((record) => record.id === entry.id)?.source).toBe("public");
  await f.app.session.send({ type: "run", sessionId: "dictionary-chat", prompt });
  expect(JSON.stringify(f.requests.at(-1))).not.toContain("LOCAL_MEANING");
  expect(JSON.stringify(f.requests.at(-1))).toContain(entry.term);
});

test("dictionary rejects malformed IPC payloads without replacing project memory", async () => {
  const f = await fixture();
  await expect(
    f.handlers["dictionary.save"]({
      type: "dictionary.save",
      entry: { id: "../escape", term: "bad" },
    }),
  ).rejects.toThrow();
  expect(await Bun.file(join(f.cwd, ".liquid/memory.json")).exists()).toBe(false);
  await expect(
    f.handlers["dictionary.forget"]({
      type: "dictionary.forget",
      id: "missing",
      expectedRevision: 0,
    }),
  ).rejects.toThrow();
});

test("local definitions preserve valid categories longer than memory topic labels", async () => {
  const f = await fixture();
  const category = "a".repeat(80);
  const saved = DictionarySnapshotSchema.parse(
    (
      await f.handlers["dictionary.save"]({
        type: "dictionary.save",
        entry: {
          id: "long-category",
          term: "Long category term",
          category,
          definition: "A valid local definition.",
        },
      })
    )?.dictionary,
  );
  expect(saved.entries.find((record) => record.id === "long-category")?.category).toBe(category);
  const disk = await Bun.file(join(f.cwd, ".liquid/memory.json")).json();
  expect(disk.records[0].dictionary.category).toBe(category);
});
