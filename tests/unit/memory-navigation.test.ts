import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryWriteSchema } from "../../src/core/memory/schema";
import { memoryDigest } from "../../src/core/memory/sources";
import type { MemoryWrite } from "../../src/core/memory/types";
import { createSession } from "../../src/core/session/session";
import type { Event } from "../../src/core/types";
import type { ModelEvent } from "../../src/providers/types";
import { MemoryStore } from "../../src/store/memory";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

const directories: string[] = [];
const limits = {
  maxOutputBytes: 50000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10000,
  readLimitLines: 2000,
};
const quote =
  "For permanent project reports, always include the revision identifier in the filename.";
const finish: ModelEvent[] = [
  { type: "text", delta: "Completed" },
  { type: "done", reason: "end" },
];
const call = (id: string, args: unknown): ModelEvent[] => [
  { type: "tool_call", id, name: "memory", args },
  { type: "done", reason: "tool_use" },
];

function draft(key: string, changes: Partial<MemoryWrite> = {}): MemoryWrite {
  return {
    key,
    kind: "preference",
    summary: "Reports include revision",
    content: "Name reports with their revision identifier.",
    reason: "The naming correction is absent from project files.",
    cues: [],
    priority: "normal",
    topics: ["Report naming"],
    appliesWhen: "Creating a permanent diagnostic report",
    sources: [
      { sessionId: "prior", reference: "user:0", role: "user", quote, digest: memoryDigest(quote) },
    ],
    ...changes,
  };
}
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "memory-navigation-"));
  directories.push(cwd);
  const store = new MemoryStore({ cwd });
  return { cwd, store };
}
function session(cwd: string, store: MemoryStore, scripts: ModelEvent[][]) {
  const provider = scriptedProvider(scripts);
  const events: Event[] = [];
  const run = createSession({
    cwd,
    memory: store,
    provider,
    providerId: "test",
    model: "test",
    system: "Project instructions",
    responseFormat: "conversation",
    tools: new ToolRegistry(builtinTools(), { limits }),
    limits,
    maxOutputTokens: 2000,
    context: { window: 100000, reserve: 2000 },
    loop: { maxTurns: 12, continuations: 0, parallelTools: false },
    logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
  });
  run.subscribe((event) => events.push(event));
  return { run, provider, events };
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

test("old records stay reachable through topics and batch read without draining distractors", async () => {
  const { cwd, store } = await fixture();
  const old = await store.put(draft("reports/revision"));
  const related = await store.put(
    draft("reports/review", {
      summary: "Reports are reviewed",
      content: "Have the user review published reports.",
    }),
  );
  for (let offset = 0; offset < 80; offset += 8) {
    await store.reconcile({
      save: Array.from({ length: 8 }, (_, index) =>
        draft(`noise/${offset + index}`, {
          summary: `Unrelated recent setting ${offset + index}`,
          content: `Unrelated setting ${offset + index}.`,
          topics: ["Editor preferences"],
        }),
      ),
      forget: [],
    });
  }
  const run = session(cwd, store, [
    call("topic", { operation: "list", topic: "Report naming" }),
    call("batch", { operation: "read", ids: [old.id, related.id] }),
    call("repeat", { operation: "read", ids: [old.id, related.id] }),
    finish,
  ]);
  await run.run.send({ type: "run", prompt: "Составь диагностический документ." });
  const directory = run.provider.requests[0]?.messages.find((message) =>
    message.content.includes("## Memory topics"),
  );
  expect(directory?.content).toContain("Report naming");
  expect(directory?.content).not.toContain(old.id);
  const output = (id: string) =>
    run.events.find((event) => event.type === "tool.finished" && event.call.id === id);
  const browse = output("topic");
  expect(browse?.type === "tool.finished" && browse.result.output).toContain(old.id);
  expect(browse?.type === "tool.finished" && browse.result.output).not.toContain(
    "Unrelated recent",
  );
  const batch = output("batch");
  expect(batch?.type === "tool.finished" && batch.result.ok).toBe(true);
  expect(batch?.type === "tool.finished" && batch.result.output).toContain(old.content);
  const repeat = output("repeat");
  expect(repeat?.type === "tool.finished" && repeat.result.output).toContain(
    "already fully visible",
  );
  expect(
    run.events.filter(
      (event) => event.type === "memory.context" && event.text.includes("## Memory topics"),
    ),
  ).toHaveLength(1);
  await run.run.dispose();
});

test("topic directory pages every model-authored topic and old records need no migration", async () => {
  const { cwd, store } = await fixture();
  await store.put(draft("old/unclassified", { topics: undefined, appliesWhen: undefined }));
  for (let offset = 0; offset < 24; offset += 8) {
    await store.reconcile({
      save: Array.from({ length: 8 }, (_, n) =>
        draft(`item/${offset + n}`, { topics: [`Topic ${String(offset + n).padStart(2, "0")}`] }),
      ),
      forget: [],
    });
  }
  const run = session(cwd, store, [
    call("first", { operation: "topics" }),
    call("second", { operation: "topics", cursor: 12 }),
    call("last", { operation: "topics", cursor: 24 }),
    call("legacy", { operation: "list", topic: "Uncategorized" }),
    finish,
  ]);
  await run.run.send({ type: "run", prompt: "Browse available knowledge" });
  const results = run.events.filter((event) => event.type === "tool.finished");
  expect(results.every((event) => event.type === "tool.finished" && event.result.ok)).toBe(true);
  expect(results[0]?.result.output).toContain("Next cursor: 12");
  expect(results[1]?.result.output).toContain("Next cursor: 24");
  expect(results[2]?.result.output).toContain("Uncategorized");
  expect(results[3]?.result.output).toContain("old/unclassified");
  await run.run.dispose();
});

test("reconciliation validates every source before atomically replacing contradictory keys", async () => {
  const { cwd, store } = await fixture();
  const old = await store.put(draft("reports/obsolete"));
  const correction =
    "Use the new report name Route Ledger permanently; the old project label is withdrawn.";
  const { sources: _sources, ...fields } = draft("reports/current", {
    summary: "Use Route Ledger",
    content: "Use Route Ledger as the report title.",
  });
  const valid = { ...fields, expectedRevision: 0, evidence: [{ role: "user", quote: correction }] };
  const run = session(cwd, store, [
    call("reject", {
      operation: "reconcile",
      save: [
        {
          ...valid,
          evidence: [{ role: "user", quote: "This quote was fabricated by the agent." }],
        },
      ],
      forget: [{ id: old.id, expectedRevision: 1 }],
    }),
    call("commit", {
      operation: "reconcile",
      save: [valid],
      forget: [{ id: old.id, expectedRevision: 1 }],
    }),
    finish,
  ]);
  await run.run.send({ type: "run", prompt: correction });
  const results = run.events.filter((event) => event.type === "tool.finished");
  expect(results[0]?.result.ok).toBe(false);
  expect(results[1]?.result.ok).toBe(true);
  expect((await store.list()).find((record) => record.id === old.id)?.status).toBe("forgotten");
  expect((await store.list()).filter((record) => record.status === "active")).toHaveLength(1);
  expect(
    run.run
      .getHistory()
      .some(
        (message) =>
          message.role === "tool" &&
          message.memoryReferences?.some((ref) => ref.id === old.id && ref.level === "invalidated"),
      ),
  ).toBe(true);
  await run.run.dispose();
});

test("reconciliation cannot bypass user authority and topic metadata has storage-compatible boundaries", async () => {
  const parsed = memoryWriteSchema.safeParse(
    draft("reports/a", { topics: ["Тексты и отчёты"], appliesWhen: "Перед публикацией" }),
  );
  expect(parsed.success).toBe(true);
  const { cwd, store } = await fixture();
  const { sources: _sources, ...fields } = draft("forged/lesson");
  const run = session(cwd, store, [
    call("forged", {
      operation: "reconcile",
      save: [{ ...fields, expectedRevision: 0, evidence: [{ role: "tool", quote }] }],
    }),
    finish,
  ]);
  await run.run.send({ type: "run", prompt: quote });
  expect(await store.list()).toEqual([]);
  await run.run.dispose();
});
