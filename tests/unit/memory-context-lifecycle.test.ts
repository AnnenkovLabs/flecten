import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryCandidate } from "../../src/core/memory/command";
import { memoryDigest } from "../../src/core/memory/sources";
import { createSession, type SessionOptions } from "../../src/core/session/session";
import type { Event } from "../../src/core/types";
import type { ModelEvent } from "../../src/providers/types";
import { PermissionEngine } from "../../src/security/permissions";
import { SandboxPolicy } from "../../src/security/sandbox";
import { replayMessages } from "../../src/store/events/replay";
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
  "Please change the interaction model when redesigning, with visible evidence of the change.";
const candidate: MemoryCandidate = {
  key: "design/interaction",
  kind: "lesson",
  summary: "Show interaction changes",
  content: "A redesign must change the working interaction, with evidence.",
  reason: "The user corrected a prior superficial redesign; this is absent from project files.",
  cues: ["design"],
  priority: "critical",
  expectedRevision: 0,
  evidence: [{ role: "user", quote }],
};
const answer = (text: string): ModelEvent[] => [
  { type: "text", delta: text },
  { type: "done", reason: "end" },
];
const call = (id: string, args: unknown): ModelEvent[] => [
  { type: "tool_call", id, name: "memory", args },
  { type: "done", reason: "tool_use" },
];
const fields = {
  progress: "Earlier design reviewed",
  locations: "none",
  instructions: "Keep user correction",
  nextSteps: "Continue",
  risks: "none",
};
async function fixture(scripts: ModelEvent[][], overrides: Partial<SessionOptions> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "memory-lifecycle-"));
  directories.push(cwd);
  const store = new MemoryStore({ cwd });
  const provider = scriptedProvider(scripts);
  const options: SessionOptions = {
    cwd,
    provider,
    providerId: "test",
    model: "test",
    system: "Project instructions",
    responseFormat: "conversation",
    tools: new ToolRegistry(builtinTools(), { limits }),
    limits,
    maxOutputTokens: 2000,
    context: { window: 100000, reserve: 2000 },
    loop: { maxTurns: 10, continuations: 0, parallelTools: false },
    logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
    memory: store,
    ...overrides,
  };
  const session = createSession(options);
  const events: Event[] = [];
  session.subscribe((event) => events.push(event));
  return { cwd, store, provider, options, session, events };
}
async function seed(store: MemoryStore, changes: Partial<MemoryCandidate> = {}) {
  const { evidence: _evidence, ...fields } = { ...candidate, ...changes };
  return store.put({
    ...fields,
    sources: [
      {
        role: "user",
        quote,
        sessionId: "earlier",
        digest: memoryDigest(quote),
        reference: "user:0",
      },
    ],
  });
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

test("idle compaction captures evidence before it disappears, then restores memory without another model call", async () => {
  const long = "A detailed design explanation with concrete working behavior. ".repeat(150);
  const run = await fixture([
    answer(long),
    answer(long),
    answer(JSON.stringify({ ...fields, memoryCandidates: [candidate] })),
    answer("Continue"),
  ]);
  const first = (await run.session.send({ type: "run", prompt: quote })) as { sessionId: string };
  await run.session.send({ type: "run", sessionId: first.sessionId, prompt: "Now continue" });
  const compacted = (await run.session.send({ type: "context.compact" })) as { compacted: boolean };
  expect(compacted.compacted).toBe(true);
  expect(run.provider.requests).toHaveLength(3);
  const [record] = await run.store.list();
  expect(record?.sources[0]?.quote).toBe(quote);
  expect(
    run.session
      .getHistory()
      .some((message) => message.role === "user" && message.memorySource === quote),
  ).toBe(false);
  await run.session.send({
    type: "run",
    sessionId: first.sessionId,
    prompt: "Apply the next design change",
  });
  expect(run.provider.requests).toHaveLength(4);
  expect(
    run.provider.requests[3]?.messages.some(
      (message) =>
        message.role !== "assistant" &&
        message.memoryReferences?.some((ref) => ref.id === record?.id && ref.level === "full"),
    ),
  ).toBe(true);
  expect(run.provider.requests[3]?.system).toBe("Project instructions");
  await run.session.dispose();
});

test("a new revision and forget invalidate bodies already in the same conversation", async () => {
  const run = await fixture([answer("Ready"), answer("Ready"), answer("Ready")]);
  const record = await seed(run.store);
  const first = (await run.session.send({ type: "run", prompt: "Prepare design" })) as {
    sessionId: string;
  };
  await seed(run.store, { content: "The new approved interaction rule.", expectedRevision: 1 });
  await run.session.send({ type: "run", sessionId: first.sessionId, prompt: "Continue design" });
  const revision = run.events.filter((event) => event.type === "memory.context").at(-1);
  expect(revision?.type === "memory.context" && revision.text).toContain("superseded");
  expect(
    revision?.type === "memory.context" &&
      revision.references.some((ref) => ref.id === record.id && ref.revision === 2),
  ).toBe(true);
  await run.store.forget(record.id, 2);
  await run.session.send({ type: "run", sessionId: first.sessionId, prompt: "Finish design" });
  const forgotten = run.events.filter((event) => event.type === "memory.context").at(-1);
  expect(forgotten?.type === "memory.context" && forgotten.text).toContain("forgotten");
  const replayed = replayMessages(run.events.map((event, index) => ({ seq: index + 1, event })));
  expect(
    replayed.messages.some(
      (message) =>
        message.role !== "assistant" &&
        message.memoryReferences?.some((ref) => ref.revision === 3 && ref.level === "invalidated"),
    ),
  ).toBe(true);
  await run.session.dispose();
});

test("automatic discovery has one context budget instead of draining the entire bank over tool turns", async () => {
  const run = await fixture([
    call("sources1", { operation: "sources" }),
    call("sources2", { operation: "sources" }),
    answer("Ready"),
  ]);
  for (let index = 0; index < 40; index++)
    await seed(run.store, {
      key: `topic/${index}`,
      summary: `Important topic ${index}`,
      priority: "normal",
    });
  await run.session.send({ type: "run", prompt: "Inspect the project" });
  const deliveries = run.events.filter((event) => event.type === "memory.context");
  const references = deliveries.flatMap((event) =>
    event.type === "memory.context" ? event.references : [],
  );
  expect(references.length).toBeLessThan(40);
  expect(
    deliveries.reduce(
      (sum, event) => sum + (event.type === "memory.context" ? event.text.length : 0),
      0,
    ),
  ).toBeLessThan(5000);
  await run.session.dispose();
});

test("a clipped memory read never claims a full visible body", async () => {
  const run = await fixture([]);
  const record = await seed(run.store, {
    content: "A long conditional memory. ".repeat(80),
    priority: "normal",
  });
  const shortLimits = { ...limits, maxOutputBytes: 150 };
  const provider = scriptedProvider([
    call("read1", { operation: "read", id: record.id }),
    call("read2", { operation: "read", id: record.id }),
    answer("Ready"),
  ]);
  const session = createSession({
    ...run.options,
    provider,
    tools: new ToolRegistry(builtinTools(), { limits: shortLimits }),
    limits: shortLimits,
  });
  const events: Event[] = [];
  session.subscribe((event) => events.push(event));
  await session.send({ type: "run", prompt: "Inspect this memory" });
  const second = events.find(
    (event) => event.type === "tool.finished" && event.call.id === "read2",
  );
  expect(second?.type === "tool.finished" && second.result.output).not.toContain(
    "already fully visible",
  );
  expect(
    session
      .getHistory()
      .filter((message) => message.role === "tool")
      .every((message) => !message.memoryReferences?.some((ref) => ref.level === "full")),
  ).toBe(true);
  await session.dispose();
  await run.session.dispose();
});

test("background recall and compaction obey deny policies without an approval request", async () => {
  const permissions = new PermissionEngine({
    rules: [
      { action: "read", tool: "memory", policy: "deny" },
      { action: "write", tool: "memory", policy: "deny" },
    ],
  });
  const long = "Detailed completed work. ".repeat(300);
  const run = await fixture(
    [
      answer(long),
      answer(long),
      answer(JSON.stringify({ ...fields, memoryCandidates: [candidate] })),
    ],
    { permissions },
  );
  await seed(run.store);
  const first = (await run.session.send({ type: "run", prompt: quote })) as { sessionId: string };
  await run.session.send({ type: "run", sessionId: first.sessionId, prompt: "Continue" });
  await run.session.send({ type: "context.compact" });
  const notices = run.events.filter((event) => event.type === "memory.context");
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({ references: [] });
  expect(notices[0]?.text).toContain("Memory checkpoint failed");
  expect((await run.store.list())[0]?.revision).toBe(1);
  expect(permissions.pending()).toHaveLength(0);
  await run.session.dispose();
});

test("an idle checkpoint failure survives compaction and event replay with automatic reads denied", async () => {
  const permissions = new PermissionEngine({
    rules: [
      { action: "read", tool: "memory", policy: "deny" },
      { action: "write", tool: "memory", policy: "auto" },
    ],
  });
  const long = "A detailed explanation with concrete working behavior. ".repeat(150);
  const run = await fixture(
    [
      answer(long),
      answer(long),
      answer(JSON.stringify({ ...fields, memoryCandidates: [candidate] })),
      answer("Continue"),
    ],
    { permissions },
  );
  const first = (await run.session.send({
    type: "run",
    prompt: "No preference in this input.",
  })) as {
    sessionId: string;
  };
  await run.session.send({ type: "run", sessionId: first.sessionId, prompt: "Continue" });
  await run.session.send({ type: "context.compact" });
  expect(await run.store.list()).toEqual([]);
  const compacted = run.events.find((event) => event.type === "context.compacted");
  expect(compacted?.summary).toContain(fields.instructions);
  const notice = run.events.find((event) => event.type === "memory.context");
  expect(notice?.text).toContain("Evidence must exactly quote a real source");
  expect(notice?.references).toEqual([]);
  const replayed = replayMessages(run.events.map((event, index) => ({ seq: index + 1, event })));
  expect(
    replayed.messages.some((message) => message.content.includes("Memory checkpoint failed")),
  ).toBe(true);
  await run.session.send({ type: "run", sessionId: first.sessionId, prompt: "Continue" });
  expect(
    run.provider.requests
      .at(-1)
      ?.messages.some((message) => message.content.includes("Memory checkpoint failed")),
  ).toBe(true);
  expect(permissions.pending()).toHaveLength(0);
  await run.session.dispose();
});

test("native memory persists in the default sandbox while raw metadata writes remain blocked", async () => {
  const run = await fixture([call("save", { operation: "save", ...candidate }), answer("Ready")]);
  const sandbox = new SandboxPolicy({ workspaceRoot: run.cwd });
  run.session.update({ sandbox });
  await run.session.send({ type: "run", prompt: quote });
  expect((await run.store.list()).length).toBe(1);
  expect((await sandbox.checkWrite(".liquid/memory.json")).allowed).toBe(false);
  expect((await sandbox.checkMemory("write")).allowed).toBe(true);
  const denied = new SandboxPolicy({
    workspaceRoot: run.cwd,
    writeDenyPrefixes: [".liquid/memory.json"],
  });
  expect((await denied.checkMemory("write")).allowed).toBe(false);
  await run.session.dispose();
});
