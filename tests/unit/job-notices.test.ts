import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HooksConfig } from "../../src/core/hooks/types";
import { createSession, type SessionHandle } from "../../src/core/session/session";
import type { Event, Message } from "../../src/core/types";
import type { ModelEvent } from "../../src/providers/types";
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

const bash = (id: string, args: Record<string, unknown>): ModelEvent[] => [
  { type: "tool_call", id, name: "bash", args },
  { type: "done", reason: "tool_use" },
];
const end = (text: string): ModelEvent[] => [
  { type: "text", delta: text },
  { type: "done", reason: "end" },
];

async function jobSession(scripts: ModelEvent[][], hooks?: HooksConfig) {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-job-notices-"));
  const provider = scriptedProvider(scripts);
  const session = createSession({
    cwd,
    provider,
    providerId: "scripted",
    model: "scripted-1",
    tools: new ToolRegistry(builtinTools(), { limits }),
    system: "test",
    limits,
    maxOutputTokens: 1000,
    context: { window: 100_000, reserve: 1000 },
    loop: { maxTurns: 6, continuations: 0, parallelTools: false },
    ...(hooks ? { hooks } : {}),
    logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
  });
  const events: Event[] = [];
  session.subscribe((event) => events.push(event));
  cleanups.push(async () => {
    await session.dispose();
    await rm(cwd, { recursive: true, force: true });
  });
  return { session, provider, events };
}

function notices(provider: ScriptedProvider, request: number): string[] {
  const messages: Message[] = provider.requests[request]?.messages ?? [];
  return messages
    .filter(
      (message) =>
        message.role === "user" && String(message.content).includes("# Background job notice"),
    )
    .map((message) => String(message.content));
}

async function finished(events: Event[], session: SessionHandle): Promise<Event> {
  for (let waited = 0; waited < 5000; waited += 20) {
    const event = events.find((entry) => entry.type === "job.finished");
    if (event) return event;
    await Bun.sleep(20);
  }
  throw new Error(`no job.finished for ${session.getSessionId()}`);
}

describe("background job notices", () => {
  test("a finished job invokes the notification hook even between runs", async () => {
    const notifications: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        notifications.push(await request.json());
        return Response.json({});
      },
    });
    cleanups.push(async () => {
      server.stop(true);
    });
    const { session, events } = await jobSession(
      [bash("bg", { command: "sleep 0.1; echo built", background: true }), end("started")],
      { notification: [{ type: "http", url: server.url.href, timeoutMs: 1000, enabled: true }] },
    );
    await session.send({ type: "run", prompt: "start" });
    await finished(events, session);
    for (let attempts = 0; attempts < 100 && notifications.length === 0; attempts += 1)
      await Bun.sleep(10);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      event: "notification",
      sessionId: session.getSessionId(),
      notification: { level: "info", code: "job.finished" },
    });
  });

  test("a job that ends between runs reaches the model at the start of the next run", async () => {
    const { session, provider, events } = await jobSession([
      bash("bg", { command: "sleep 0.2; echo build-ok", background: true }),
      end("started"),
      end("seen"),
    ]);
    await session.send({ type: "run", prompt: "start the build" });
    expect(String(provider.requests[1]?.messages.at(-1)?.content)).toContain("job");
    const event = await finished(events, session);
    expect(event).toMatchObject({ sessionId: session.getSessionId(), job: { exitCode: 0 } });

    const secondRun = provider.requests.length;
    if (event.type !== "job.finished") throw new Error("expected job.finished");
    await session.send({ type: "run", prompt: "what happened?", sessionId: event.sessionId });
    const [notice] = notices(provider, secondRun);
    expect(notice).toContain("- Status: `exited`\n- Exit code: `0`");
    expect(notice).toContain("## Untrusted data\n\n- Source: `shell`");
    expect(notice).toContain("build-ok");
    expect(events.some((entry) => entry.type === "notice.applied")).toBe(true);

    const thirdRun = provider.requests.length;
    await session.send({ type: "run", prompt: "anything else?", sessionId: event.sessionId });
    expect(notices(provider, thirdRun)).toHaveLength(1);
  });

  test("a new task on the same handle does not get another task's notice", async () => {
    const { session, provider, events } = await jobSession([
      bash("bg", { command: "sleep 0.2; echo build-ok", background: true }),
      end("started"),
    ]);
    await session.send({ type: "run", prompt: "start the build" });
    const event = await finished(events, session);
    if (event.type !== "job.finished") throw new Error("expected job.finished");

    const otherTask = provider.requests.length;
    await session.send({ type: "run", prompt: "an unrelated task" });
    expect(provider.requests[otherTask]?.messages).toHaveLength(1);
    expect(notices(provider, otherTask)).toHaveLength(0);

    const ownTask = provider.requests.length;
    await session.send({ type: "run", prompt: "back to the build", sessionId: event.sessionId });
    expect(notices(provider, ownTask)).toHaveLength(1);
  });

  test("a job that ends during a run arrives at the next turn boundary, once", async () => {
    const { session, provider } = await jobSession([
      bash("bg", { command: "sleep 0.1; echo early", background: true }),
      bash("fg", { command: "sleep 0.6" }),
      end("done"),
    ]);
    await session.send({ type: "run", prompt: "build and wait" });
    expect(notices(provider, 1)).toHaveLength(0);
    expect(notices(provider, 2)).toHaveLength(1);
    expect(notices(provider, 2)[0]).toContain("early");
    expect(notices(provider, provider.requests.length - 1)).toHaveLength(1);
  });
});
