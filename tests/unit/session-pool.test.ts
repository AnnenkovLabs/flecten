import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionPool } from "../../src/app/session-pool";
import { createSession } from "../../src/core/session/session";
import type { Event } from "../../src/core/types";
import type { ModelEvent } from "../../src/providers/types";
import { PermissionEngine } from "../../src/security/permissions";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { type ScriptedProvider, scriptedProvider } from "../helpers/fake-provider";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const bash = (command: string): ModelEvent[] => [
  { type: "tool_call", id: "call-1", name: "bash", args: { command } },
  { type: "done", reason: "tool_use" },
];
const end: ModelEvent[] = [
  { type: "text", delta: "finished" },
  { type: "done", reason: "end" },
];

/** A pool whose n-th new task gets the n-th script; bash always asks for approval. */
async function pool(scripts: ModelEvent[][][], maxActive = 4, secrets: readonly string[] = []) {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-pool-"));
  const providers: ScriptedProvider[] = [];
  const sessions = new SessionPool({
    maxActive: () => maxActive,
    secrets: () => secrets,
    create: async (sessionId) => {
      const provider = scriptedProvider(scripts[providers.length] ?? [end]);
      providers.push(provider);
      return createSession({
        cwd,
        provider,
        providerId: "scripted",
        model: "scripted-1",
        tools: new ToolRegistry(builtinTools(), { limits }),
        system: "test",
        limits,
        maxOutputTokens: 1000,
        context: { window: 100_000, reserve: 1000 },
        loop: { maxTurns: 4, continuations: 0, parallelTools: false },
        logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
        permissions: new PermissionEngine({
          rules: [{ action: "shell", tool: "bash", policy: "ask" }],
        }),
        ...(sessionId === undefined ? {} : { sessionId }),
      });
    },
  });
  const events: Event[] = [];
  sessions.subscribe((event) => events.push(event));
  cleanups.push(async () => {
    await sessions.dispose();
    await rm(cwd, { recursive: true, force: true });
  });
  return { sessions, events, providers };
}

async function approvals(events: Event[], count: number) {
  for (let waited = 0; waited < 5000; waited += 10) {
    const requested = events.flatMap((event) =>
      event.type === "approval.requested" ? [event] : [],
    );
    if (requested.length >= count) return requested;
    await Bun.sleep(10);
  }
  throw new Error(`expected ${count} approval requests`);
}

function toolOutput(provider: ScriptedProvider | undefined): string {
  const messages = provider?.requests.at(-1)?.messages ?? [];
  return messages
    .filter((message) => message.role === "tool")
    .map((message) => String(message.content))
    .join("\n");
}

describe("session pool", () => {
  test("redacts split secrets before general event listeners and replay receive them", async () => {
    const { sessions, events } = await pool(
      [
        [
          [
            { type: "text", delta: "before opaque " },
            { type: "text", delta: "credential after" },
            { type: "done", reason: "end" },
          ],
        ],
      ],
      4,
      ["opaque credential"],
    );
    await sessions.send({ type: "run", prompt: "go" });
    const streamed = events
      .flatMap((event) => (event.type === "message.delta" ? [event.text] : []))
      .join("");
    expect(streamed).toBe("before [redacted] after");
    expect(JSON.stringify(events)).not.toContain("opaque credential");
    expect(JSON.stringify(sessions.replay(sessions.getSessionId() ?? ""))).not.toContain(
      "opaque credential",
    );
  });

  test("an approval answered after switching tasks reaches the task that waits", async () => {
    const { sessions, events, providers } = await pool([[bash("echo from-a"), end], [end]]);
    const runA = sessions.send({ type: "run", prompt: "task a" });
    const [request] = await approvals(events, 1);
    if (!request) throw new Error("no approval request");

    await sessions.send({ type: "run", prompt: "task b" });
    expect(sessions.getSessionId()).not.toBe(request.sessionId);
    expect(sessions.waitsFor(request.approval.id)).toBe(true);

    await sessions.send({
      type: "approval.respond",
      id: request.approval.id,
      decision: "allow_once",
    });
    await runA;
    expect(toolOutput(providers[0])).toContain("from-a");
    expect(sessions.waitsFor(request.approval.id)).toBe(false);
    const resolved = events.find((event) => event.type === "approval.resolved");
    expect(resolved?.sessionId).toBe(request.sessionId);
  });

  test("allow all splits the ids between the tasks that own them", async () => {
    const { sessions, events, providers } = await pool([
      [bash("echo from-a"), end],
      [bash("echo from-b"), end],
    ]);
    const runA = sessions.send({ type: "run", prompt: "task a" });
    await approvals(events, 1);
    const runB = sessions.send({ type: "run", prompt: "task b" });
    const requested = await approvals(events, 2);
    expect(new Set(requested.map((event) => event.sessionId)).size).toBe(2);
    expect(sessions.activity().filter((task) => task.approvals === 1)).toHaveLength(2);

    const ids = requested.map((event) => event.approval.id);
    await sessions.send({ type: "approval.allowAll", ids });
    await Promise.all([runA, runB]);
    expect(toolOutput(providers[0])).toContain("from-a");
    expect(toolOutput(providers[1])).toContain("from-b");
    expect(sessions.isBusy()).toBe(false);
  });

  test("deny all refuses every waiting call and both tasks still finish", async () => {
    const { sessions, events, providers } = await pool([
      [bash("echo from-a"), end],
      [bash("echo from-b"), end],
    ]);
    const runA = sessions.send({ type: "run", prompt: "task a" });
    await approvals(events, 1);
    const runB = sessions.send({ type: "run", prompt: "task b" });
    const requested = await approvals(events, 2);

    await sessions.send({ type: "approval.denyAll", ids: requested.map((e) => e.approval.id) });
    const results = (await Promise.all([runA, runB])) as Array<{ stopReason: string }>;
    expect(results.map((result) => result.stopReason)).toEqual(["end", "end"]);
    for (const provider of providers) {
      expect(toolOutput(provider)).not.toContain("from-");
    }
    const resolved = events.flatMap((event) => (event.type === "approval.resolved" ? [event] : []));
    expect(resolved.map((event) => [event.choice, event.by])).toEqual([
      ["deny", "user"],
      ["deny", "user"],
    ]);
    expect(sessions.isBusy()).toBe(false);
  });

  test("a new task beyond sessions.maxConcurrent is refused with a clear reason", async () => {
    const { sessions, events } = await pool([[bash("echo from-a"), end], [end]], 1);
    const runA = sessions.send({ type: "run", prompt: "task a" });
    const [request] = await approvals(events, 1);
    if (!request) throw new Error("no approval request");

    await expect(sessions.send({ type: "run", prompt: "task b" })).rejects.toThrow(
      "Одновременно идёт задач: 1, это лимит sessions.maxConcurrent",
    );
    await sessions.send({ type: "approval.respond", id: request.approval.id, decision: "deny" });
    await runA;
    await sessions.send({ type: "run", prompt: "task b" });
    expect(sessions.activity()).toHaveLength(2);
  });
});
