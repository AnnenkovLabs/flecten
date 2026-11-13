import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryCandidate } from "../../src/core/memory/command";
import { createSession } from "../../src/core/session/session";
import type { Event } from "../../src/core/types";
import { PermissionEngine } from "../../src/security/permissions";
import { MemoryStore } from "../../src/store/memory";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

const directories: string[] = [];
const quote =
  "When I ask for a redesign, change the interaction model and show how the new behavior works.";
const candidate: MemoryCandidate = {
  key: "design/interaction",
  kind: "lesson",
  summary: "Make redesign behavior visible",
  content: "For redesign requests, change the interaction model and demonstrate the new behavior.",
  reason: "The user corrected a superficial redesign; the correction is absent from project files.",
  cues: ["redesign"],
  priority: "normal",
  expectedRevision: 0,
  evidence: [{ role: "user", quote }],
};
const limits = {
  maxOutputBytes: 50000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10000,
  readLimitLines: 2000,
};

async function fixture(
  permissions?: PermissionEngine,
  memoryCandidates = [candidate],
  outputBytes = 50000,
) {
  const cwd = await mkdtemp(join(tmpdir(), "memory-completion-"));
  directories.push(cwd);
  const store = new MemoryStore({ cwd });
  const provider = scriptedProvider([
    [
      {
        type: "tool_call",
        id: "complete",
        name: "done",
        args: {
          summary: "Interaction redesigned",
          evidence: ["The prototype shows the changed interaction"],
          ...(memoryCandidates.length ? { memoryCandidates } : {}),
        },
      },
      { type: "done", reason: "tool_use" },
    ],
  ]);
  const session = createSession({
    cwd,
    provider,
    providerId: "test",
    model: "test",
    system: "Project instructions",
    responseFormat: "conversation",
    tools: new ToolRegistry(builtinTools(), { limits: { ...limits, maxOutputBytes: outputBytes } }),
    limits,
    maxOutputTokens: 2000,
    context: { window: 100000, reserve: 2000 },
    loop: { maxTurns: 4, continuations: 0, parallelTools: false },
    logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
    memory: store,
    ...(permissions ? { permissions } : {}),
  });
  const events: Event[] = [];
  session.subscribe((event) => events.push(event));
  return { cwd, store, provider, session, events };
}

function completion(events: Event[]) {
  const event = events.find((item) => item.type === "tool.finished" && item.call.name === "done");
  if (event?.type !== "tool.finished") throw new Error("done did not execute");
  expect(event.result.ok).toBe(true);
  expect(event.result.terminate).toBe(true);
  expect(events.find((item) => item.type === "session.finished")).toMatchObject({
    result: { pass: true, stopReason: "done" },
  });
  return event.result;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

test("an ordinary user correction is captured with done in one provider request", async () => {
  const run = await fixture();
  await run.session.send({ type: "run", prompt: quote });
  const result = completion(run.events);
  expect(run.provider.requests).toHaveLength(1);
  const records = await new MemoryStore({ cwd: run.cwd }).list();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    key: candidate.key,
    content: candidate.content,
    sources: [{ role: "user", quote }],
  });
  expect(result.output).toContain(candidate.content);
  expect(result.data).toMatchObject({
    memoryReferences: [{ id: records[0]?.id, revision: 1, level: "full" }],
  });
  expect(
    run.session.getHistory().find((message) => message.role === "tool" && message.name === "done"),
  ).toMatchObject({
    memoryReferences: [{ id: records[0]?.id, revision: 1, level: "full" }],
  });
  await run.session.dispose();
});

test("rejected evidence preserves task completion and reports unsuccessful capture", async () => {
  const run = await fixture();
  await run.session.send({ type: "run", prompt: "Please finish the prototype." });
  const result = completion(run.events);
  expect(run.provider.requests).toHaveLength(1);
  expect(result.output).toContain("Memory capture failed");
  expect(result.data).not.toHaveProperty("memoryReferences");
  expect(await run.store.list()).toEqual([]);
  await run.session.dispose();
});

test.each(["deny", "ask"] as const)(
  "native completion capture honors %s write policy without requesting approval",
  async (policy) => {
    const permissions = new PermissionEngine({
      rules: [{ action: "write", tool: "memory", policy }],
    });
    const run = await fixture(permissions);
    await run.session.send({ type: "run", prompt: quote });
    const result = completion(run.events);
    expect(run.provider.requests).toHaveLength(1);
    expect(result.output).toContain("Memory capture failed");
    expect(await run.store.list()).toEqual([]);
    expect(permissions.pending()).toHaveLength(0);
    expect(run.events.some((event) => event.type === "approval.requested")).toBe(false);
    await run.session.dispose();
  },
);

test("done without memory candidates leaves durable memory unchanged", async () => {
  const run = await fixture(undefined, []);
  await run.session.send({ type: "run", prompt: quote });
  const result = completion(run.events);
  expect(run.provider.requests).toHaveLength(1);
  expect(result.output).not.toContain("Memory capture");
  expect(result.data).not.toHaveProperty("memoryReferences");
  expect(await run.store.list()).toEqual([]);
  await run.session.dispose();
});

test("clipped completion keeps task termination but never claims full memory coverage", async () => {
  const run = await fixture(undefined, [candidate], 180);
  await run.session.send({ type: "run", prompt: quote });
  const result = completion(run.events);
  expect(result.data).not.toHaveProperty("memoryReferences");
  expect(await run.store.list()).toHaveLength(1);
  expect(
    run.session
      .getHistory()
      .some((message) => message.role === "tool" && message.memoryReferences?.length),
  ).toBe(false);
  await run.session.dispose();
});

test.each([{ kind: "lesson" }, "invalid candidate"])(
  "malformed optional capture never blocks an otherwise valid completion: %j",
  async (invalid) => {
    const run = await fixture(undefined, [invalid as unknown as MemoryCandidate]);
    await run.session.send({ type: "run", prompt: quote });
    const result = completion(run.events);
    expect(result.output).toContain("Memory capture failed");
    expect(await run.store.list()).toEqual([]);
    expect(run.provider.requests).toHaveLength(1);
    await run.session.dispose();
  },
);
