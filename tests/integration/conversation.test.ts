import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversation } from "../../src/app/conversation";
import { conversationOptions } from "../../src/app/conversation-options";
import { HarnessConfigSchema } from "../../src/config/schema";
import type { SessionOptions } from "../../src/core/session/options";
import { isPersistentEvent } from "../../src/core/session/persistence";
import type { Event, SessionEvent } from "../../src/core/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";
import { bunCommand } from "../helpers/terminal-fixtures";

const fixtures: Array<{ cwd: string; session: { dispose(): Promise<void> } }> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.session.dispose();
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});
const answer = (text: string) => [
  { type: "text" as const, delta: `<summary>${text}</summary>` },
  { type: "done" as const, reason: "end" as const },
];
const progress = (text: string) => [
  { type: "text" as const, delta: text },
  { type: "done" as const, reason: "end" as const },
];
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("event timed out");
    await Bun.sleep(5);
  }
}

async function harness(
  source = 'process.stdout.write("stream-begin\\n"); setTimeout(() => {}, 30_000);',
  beforePersist?: (event: Event) => Promise<void>,
) {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-conversation-"));
  const command = await bunCommand(cwd, source);
  const config = HarnessConfigSchema.parse({ useDefaults: false, catalog: { autoRefresh: false } });
  const talker = scriptedProvider([
    [
      {
        type: "tool_call",
        id: "start",
        name: "worker",
        args: {
          operation: "start",
          task: "Inspect and verify the project. Preserve exact user requirements.",
        },
      },
      { type: "done", reason: "tool_use" },
    ],
    progress("Работа началась."),
    [
      {
        type: "tool_call",
        id: "steer",
        name: "worker",
        args: { operation: "steer", message: "Also verify the cancellation path." },
      },
      { type: "done", reason: "tool_use" },
    ],
    progress("Дополнение передано."),
    answer("<p>Работа завершена.</p>"),
  ]);
  const worker = scriptedProvider([
    [
      { type: "tool_call", id: "provider-reused-id", name: "bash", args: { command } },
      { type: "done", reason: "tool_use" },
    ],
    answer("## Result\nVerified the requested task."),
  ]);
  const events: Event[] = [];
  const stored: Event[] = [];
  const options: SessionOptions = {
    cwd,
    sessionId: "s_conversation",
    provider: talker,
    providerId: "fake",
    model: "fake",
    tools: new ToolRegistry(builtinTools(), { limits: config.tools }),
    system: "unused",
    limits: config.tools,
    maxOutputTokens: 2000,
    context: { window: 100_000, reserve: 5000 },
    loop: config.loop,
    logDir: (id) => join(cwd, id, "logs"),
    onEvent: async (event) => {
      await beforePersist?.(event);
      stored.push(event);
    },
  };
  const configure = async (
    current: SessionOptions,
    execute: Parameters<typeof conversationOptions>[3],
  ) => {
    const roles = await conversationOptions(
      current,
      config,
      [{ id: "skills", text: "PRESENTATION_SKILL_CATALOG" }],
      execute,
    );
    return {
      talker: { ...roles.talker, provider: talker },
      worker: { ...roles.worker, provider: worker },
    };
  };
  const session = await createConversation(options, { events: [], configure });
  session.subscribe((event) => events.push(event));
  fixtures.push({ cwd, session });
  const child = (type: SessionEvent["type"]) =>
    events.flatMap((event) =>
      event.type === "worker.event" && event.event.type === type ? [event.event] : [],
    );
  return { cwd, config, talker, worker, options, configure, session, events, stored, child };
}

test("conversation continues while real Worker command streams, steering reaches its next boundary, and references retain identity", async () => {
  const h = await harness(
    'process.stdout.write("stream-begin\\n"); while (!(await Bun.file("release").exists())) await Bun.sleep(20); process.stdout.write("stream-end\\n");',
  );
  await h.session.send({ type: "run", prompt: "Проверь проект. Не меняй API." });
  await until(() => h.child("tool.output").length > 0);
  expect(h.session.isBusy()).toBe(true);
  expect(h.session.peek().running).toBe(false);
  expect(h.talker.requests).toHaveLength(2);
  expect(h.events.filter((event) => event.type === "message.finished").at(-1)).toMatchObject({
    text: "Работа началась.",
  });
  expect(
    h.events.some((event) => event.type === "message.finished" && event.summary !== undefined),
  ).toBe(false);
  const started = h.child("tool.started")[0];
  if (started?.type !== "tool.started") throw new Error("missing worker call");
  expect(started.call.id).toStartWith("w_");
  expect(h.child("tool.output")[0]).toMatchObject({
    callId: started.call.id,
    text: "stream-begin\n",
  });
  h.session.update({ maxOutputTokens: 1999 });
  await h.session.send({ type: "run", prompt: "И проверь отмену, пожалуйста." });
  expect(
    h.talker.requests.some((request) =>
      request.messages.some(
        (message) => message.role === "user" && message.content === "И проверь отмену, пожалуйста.",
      ),
    ),
  ).toBe(true);
  expect(h.worker.requests.length).toBe(1);
  expect(h.talker.requests).toHaveLength(4);
  await Bun.write(join(h.cwd, "release"), "go");
  await until(() => h.child("session.finished").length === 1);
  expect(h.child("steer.applied")[0]).toMatchObject({ text: "Also verify the cancellation path." });
  expect(h.child("tool.finished")[0]).toMatchObject({
    call: { id: started.call.id },
    result: { ok: true },
  });
  expect(h.worker.requests[0]?.messages[0]).toMatchObject({
    role: "user",
    content: "Inspect and verify the project. Preserve exact user requirements.",
  });
  expect(h.worker.requests[0]?.system).not.toContain("PRESENTATION_SKILL_CATALOG");
  expect(h.talker.requests[0]?.system).toContain("PRESENTATION_SKILL_CATALOG");
  expect(h.worker.requests[0]?.system).not.toContain("data-tabs");
  await h.session.flush();
  expect(h.stored).toEqual(h.events.filter(isPersistentEvent));
  expect(
    h.stored.filter((event) => event.type === "session.started").map((event) => event.prompt),
  ).toEqual(["Проверь проект. Не меняй API.", "И проверь отмену, пожалуйста."]);
  expect(
    h.stored.some((event) => event.type === "worker.event" && event.event.type === "tool.output"),
  ).toBe(true);
}, 10_000);

test("slow Talker persistence cannot reorder concurrent Worker events in the saved conversation", async () => {
  const barrier = Promise.withResolvers<void>();
  const h = await harness(undefined, async (event) => {
    if (event.type === "message.started") await barrier.promise;
  });
  try {
    await h.session.send({ type: "run", prompt: "Проверь порядок событий." });
    await until(() => h.child("tool.output").length > 0);
    barrier.resolve();
    await h.session.flush();
    expect(h.stored).toEqual(h.events.filter(isPersistentEvent));
  } finally {
    barrier.resolve();
  }
});

test("cancel from a mirrored card aborts the actual process, and another chat cannot cancel that reference", async () => {
  const h = await harness();
  await h.session.send({ type: "run", prompt: "Начни проверку" });
  await until(() => h.child("tool.output").length > 0);
  const started = h.child("tool.started")[0];
  if (started?.type !== "tool.started") throw new Error("missing call");
  const other = await harness();
  expect(await other.session.send({ type: "tool.cancel", callId: started.call.id })).toEqual({
    cancelled: false,
  });
  expect(h.child("tool.finished")).toHaveLength(0);
  expect(await h.session.send({ type: "tool.cancel", callId: started.call.id })).toEqual({
    cancelled: true,
  });
  await until(() => h.child("tool.finished").length > 0);
  expect(h.child("tool.finished")[0]).toMatchObject({
    result: { ok: false, data: { cancelled: true } },
  });
}, 10_000);

test("force stop reaches the Worker independently from a finished Talker response", async () => {
  const h = await harness();
  await h.session.send({ type: "run", prompt: "Начни проверку" });
  await until(() => h.child("tool.output").length > 0);
  await h.session.send({ type: "stop", mode: "force" });
  await until(() => h.child("session.finished").length > 0);
  expect(h.child("session.finished")[0]).toMatchObject({ result: { stopReason: "stopped" } });
  expect(h.worker.requests).toHaveLength(1);
  expect(h.session.isBusy()).toBe(false);
}, 10_000);

test("durable replay keeps mirror IDs and restores Worker history without copying the user's conversation", async () => {
  const h = await harness('console.log("verified")');
  await h.session.send({ type: "run", prompt: "Сохрани исходную формулировку дословно." });
  await until(() => h.child("session.finished").length > 0);
  await until(() => h.events.some((event) => event.type === "session.started" && event.internal));
  await h.session.flush();
  await h.session.dispose();
  const { DurableEventLog } = await import("../../src/store/events/envelope");
  const { readSession } = await import("../../src/store/events/read");
  const { sessionPaths } = await import("../../src/store/paths");
  const log = await DurableEventLog.open(
    sessionPaths(h.cwd, "s_conversation").events,
    "s_conversation",
  );
  for (const event of h.stored) await log.append(event);
  await log.close();
  const stored = await readSession(h.cwd, "s_conversation");
  const originalCall = h.child("tool.started")[0];
  if (originalCall?.type !== "tool.started") throw new Error("missing call");
  expect(stored).toContainEqual({
    type: "worker.event",
    sessionId: "s_conversation",
    event: originalCall,
    timestamp: expect.any(Number),
  });
  const resumedWorker = scriptedProvider([answer("Restored the execution context.")]);
  const resumedTalker = scriptedProvider([
    [
      {
        type: "tool_call",
        name: "worker",
        id: "resume",
        args: { operation: "start", task: "Inspect the previous verification result." },
      },
      { type: "done", reason: "tool_use" },
    ],
    answer("<p>Контекст восстановлен.</p>"),
  ]);
  const restored = await createConversation(h.options, {
    events: stored,
    configure: async (options, execute) => {
      const roles = await h.configure(options, execute);
      return {
        talker: { ...roles.talker, provider: resumedTalker },
        worker: { ...roles.worker, provider: resumedWorker },
      };
    },
  });
  fixtures.push({ cwd: h.cwd, session: restored });
  await restored.send({ type: "run", prompt: "Продолжай" });
  await until(() => resumedWorker.requests.length > 0);
  const history = resumedWorker.requests[0]?.messages ?? [];
  expect(
    history.some(
      (message) => message.role === "tool" && message.toolCallId === originalCall.call.id,
    ),
  ).toBe(true);
  expect(
    history.some(
      (message) =>
        message.role === "user" && message.content.includes("Сохрани исходную формулировку"),
    ),
  ).toBe(false);
  expect(
    stored.flatMap((event) =>
      event.type === "session.started" && !event.internal ? [event.prompt] : [],
    ),
  ).toEqual(["Сохрани исходную формулировку дословно."]);
}, 10_000);
