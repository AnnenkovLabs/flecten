import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkerAssignment } from "../../shared/worker-assignment";
import { createConversation } from "../../src/app/conversation";
import { conversationOptions } from "../../src/app/conversation-options";
import { HarnessConfigSchema } from "../../src/config/schema";
import type { SessionOptions } from "../../src/core/session/options";
import type { Event } from "../../src/core/types";
import { TransportError } from "../../src/providers/transport";
import type { ModelEvent, ModelProvider } from "../../src/providers/types";
import { eventSchema } from "../../src/store/events/read";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { scriptedProvider } from "../helpers/fake-provider";

const fixtures: Array<{ cwd: string; session: Awaited<ReturnType<typeof createConversation>> }> =
  [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.session.dispose();
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});
const text = (content: string): ModelEvent[] => [
  { type: "text", delta: content },
  { type: "done", reason: "end" },
];
const call = (name: string, args: unknown, id: string = crypto.randomUUID()): ModelEvent[] => [
  { type: "tool_call", name, args, id },
  { type: "done", reason: "tool_use" },
];
const assignment: WorkerAssignment = {
  objective: "Explain the supplied historical source in Ukrainian.",
  userConstraints: ["Пиши українською. Не вигадуй фактів."],
  expectedOutputs: ["A short explanation with a quotation from the source."],
  acceptanceCriteria: [
    {
      id: "source",
      description: "Read the supplied source and support the explanation with its quotation.",
      evidenceRequirement: "tool_result",
    },
    {
      id: "language",
      description: "The explanation is concise Ukrainian.",
      evidenceRequirement: "model_assertion",
    },
  ],
};
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Acceptance event timed out");
    await Bun.sleep(5);
  }
}
async function fixture(worker: ModelProvider, talkerScripts: ModelEvent[][]) {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-acceptance-"));
  await Bun.write(
    join(cwd, "source.txt"),
    "Справжнє джерело: місто отримало самоврядування у 1494 році.",
  );
  const config = HarnessConfigSchema.parse({ useDefaults: false, catalog: { autoRefresh: false } });
  const talker = scriptedProvider(talkerScripts);
  const events: Event[] = [];
  const stored: Event[] = [];
  const options: SessionOptions = {
    cwd,
    sessionId: "acceptance",
    provider: talker,
    providerId: "fake",
    model: "fake",
    tools: new ToolRegistry(builtinTools(), { limits: config.tools }),
    system: "unused",
    limits: config.tools,
    maxOutputTokens: 2000,
    context: { window: 100_000, reserve: 2000 },
    loop: { ...config.loop, maxTurns: 20 },
    logDir: (id) => join(cwd, id, "logs"),
    onEvent: (event) => {
      stored.push(event);
    },
  };
  const configure = async (
    current: SessionOptions,
    execute: Parameters<typeof conversationOptions>[3],
  ) => {
    const roles = await conversationOptions(current, config, [], execute);
    return {
      talker: { ...roles.talker, provider: talker },
      worker: { ...roles.worker, provider: worker },
    };
  };
  const session = await createConversation(options, { events: [], configure });
  session.subscribe((event) => events.push(event));
  fixtures.push({ cwd, session });
  return { cwd, config, options, configure, session, events, stored, talker };
}
const latest = (events: Event[]) => events.findLast((event) => event.type === "worker.acceptance");

test("a structured assignment cannot present a paraphrase as a verbatim user constraint", async () => {
  const worker = scriptedProvider([text("<summary>Should not run.</summary>")]);
  const h = await fixture(worker, [
    call("worker", { operation: "start", assignment }),
    text("Потрібно зберегти точні слова користувача."),
  ]);
  await h.session.send({ type: "run", prompt: "Напиши українською без вигадок." });
  expect(worker.requests).toHaveLength(0);
  expect(
    h.events.some(
      (event) =>
        event.type === "tool.finished" &&
        event.call.name === "worker" &&
        !event.result.ok &&
        event.result.error?.includes("verbatim"),
    ),
  ).toBe(true);
});

test("a noncoding assignment records observed and model-asserted evidence, and defers early Talker completion", async () => {
  const release = Promise.withResolvers<void>();
  const workerScript = scriptedProvider([
    call("criterion", { operation: "list" }),
    call("read", { path: "source.txt" }, "source-call"),
    call("criterion", {
      operation: "report",
      report: {
        criterionId: "source",
        status: "met",
        evidence: { kind: "tool_result", callId: "invented", statement: "I read it." },
      },
    }),
    call("criterion", {
      operation: "report",
      report: {
        criterionId: "source",
        status: "met",
        evidence: { kind: "model_assertion", statement: "I believe I read it." },
      },
    }),
    call("criterion", {
      operation: "report",
      report: {
        criterionId: "source",
        status: "met",
        evidence: {
          kind: "tool_result",
          callId: "source-call",
          statement: "The source records self-government in 1494.",
        },
      },
    }),
    call("criterion", {
      operation: "report",
      report: {
        criterionId: "language",
        status: "met",
        evidence: { kind: "model_assertion", statement: "The explanation uses concise Ukrainian." },
      },
    }),
    text("<summary>Місто отримало самоврядування у 1494 році.</summary>"),
  ]);
  const worker: ModelProvider = {
    ...workerScript,
    async *stream(request, signal) {
      await Promise.race([
        release.promise,
        new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        ),
      ]);
      signal.throwIfAborted();
      yield* workerScript.stream(request, signal);
    },
  };
  const h = await fixture(worker, [
    call("worker", { operation: "start", assignment }),
    text("<summary><p>Already finished.</p></summary>"),
    text("Я можу відповісти на запитання, поки триває робота."),
    text("<summary><p>Пояснення перевірено.</p></summary>"),
  ]);
  await h.session.send({
    type: "run",
    prompt: "Поясни джерело. Пиши українською. Не вигадуй фактів.",
  });
  expect(h.events.some((event) => event.type === "message.finished" && event.complete)).toBe(false);
  expect(
    h.events.some(
      (event) => event.type === "turn.finished" && event.reason === "completion_deferred",
    ),
  ).toBe(true);
  await h.session.send({ type: "run", prompt: "Ти можеш відповісти під час роботи?" });
  expect(
    h.events.some(
      (event) => event.type === "message.finished" && event.text.includes("Я можу відповісти"),
    ),
  ).toBe(true);
  release.resolve();
  await until(
    () =>
      latest(h.events)?.type === "worker.acceptance" &&
      latest(h.events)?.acceptance.phase === "accepted",
  );
  await until(() => h.events.some((event) => event.type === "message.finished" && event.complete));
  const state = latest(h.events);
  if (state?.type !== "worker.acceptance") throw new Error("Missing acceptance");
  expect(state.acceptance.assignment).toEqual(assignment);
  expect(state.acceptance.criteria[0]).toMatchObject({
    status: "met",
    evidence: { kind: "tool_result", tool: "read" },
  });
  expect(state.acceptance.criteria[0]?.evidence?.output).toContain("1494");
  expect(state.acceptance.criteria[1]).toMatchObject({
    status: "met",
    evidence: { kind: "model_assertion" },
  });
  expect(
    h.events.filter(
      (event) =>
        event.type === "worker.event" &&
        event.event.type === "tool.finished" &&
        event.event.call.name === "criterion" &&
        !event.event.result.ok,
    ),
  ).toHaveLength(2);
  expect(workerScript.requests[0]?.messages[0]?.content).toContain(assignment.userConstraints[0]);
  expect(workerScript.requests[1]?.messages.at(-1)?.content).toContain(
    assignment.acceptanceCriteria[0]?.description,
  );
  expect(workerScript.requests[1]?.messages.at(-1)?.content).toContain(
    "Required evidence: tool_result",
  );
  await h.session.flush();
  expect(
    h.stored
      .map((event) => eventSchema.parse(event))
      .filter((event) => event.type === "worker.acceptance")
      .at(-1),
  ).toEqual(state);
});

test("cancelled and interrupted assignments keep their criteria open and cannot become a final Talker summary", async () => {
  const started = Promise.withResolvers<void>();
  const worker: ModelProvider = {
    id: "waiting",
    model: "waiting",
    async *stream(_request, signal) {
      started.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      signal.throwIfAborted();
      yield { type: "done", reason: "end" };
    },
  };
  const h = await fixture(worker, [
    call("worker", { operation: "start", assignment }),
    text("Працюю."),
  ]);
  await h.session.send({
    type: "run",
    prompt: "Перевір джерело. Пиши українською. Не вигадуй фактів.",
  });
  await started.promise;
  await h.session.flush();
  const interrupted = [...h.stored];
  await h.session.send({ type: "stop", target: "worker", mode: "force" });
  await until(() =>
    h.events.some(
      (event) => event.type === "worker.event" && event.event.type === "session.finished",
    ),
  );
  expect(latest(h.events)?.acceptance).toMatchObject({
    phase: "stopped",
    criteria: [
      { id: "source", status: "open" },
      { id: "language", status: "open" },
    ],
  });
  const talker = scriptedProvider([text("<summary><p>Everything is finished.</p></summary>")]);
  const restored = await createConversation(h.options, {
    events: interrupted,
    configure: async (options, execute) => {
      const roles = await conversationOptions(options, h.config, [], execute);
      return { ...roles, talker: { ...roles.talker, provider: talker } };
    },
  });
  fixtures.push({ cwd: h.cwd, session: restored });
  const events: Event[] = [];
  restored.subscribe((event) => events.push(event));
  await restored.send({ type: "run", prompt: "Що сталося з виконанням?" });
  expect(events.some((event) => event.type === "message.finished" && event.complete)).toBe(false);
  expect(
    events.some(
      (event) => event.type === "turn.finished" && event.reason === "completion_deferred",
    ),
  ).toBe(true);
  expect(
    events.some(
      (event) =>
        event.type === "message.finished" && event.text.includes("Completion remains unconfirmed"),
    ),
  ).toBe(false);
});

test("a provider error preserves open criteria instead of publishing accepted completion", async () => {
  const worker: ModelProvider = {
    id: "unavailable",
    model: "unavailable",
    async *stream() {
      yield { type: "reasoning", delta: "" };
      throw new TransportError("Authentication failed", {
        reason: "http",
        status: 401,
        retryable: false,
      });
    },
  };
  const h = await fixture(worker, [
    call("worker", { operation: "start", assignment }),
    text("Починаю перевірку."),
    text("Не вдалося продовжити."),
  ]);
  await h.session.send({
    type: "run",
    prompt: "Перевір джерело. Пиши українською. Не вигадуй фактів.",
  });
  await until(() => latest(h.events)?.acceptance.phase === "error");
  expect(latest(h.events)?.acceptance.criteria.every(({ status }) => status === "open")).toBe(true);
  expect(h.events.some((event) => event.type === "message.finished" && event.complete)).toBe(false);
});

test("open and blocked criteria survive replay and are resumed without silently changing the assignment", async () => {
  const worker = scriptedProvider([
    call("criterion", {
      operation: "report",
      report: {
        criterionId: "source",
        status: "blocked",
        reason: "The provided archive is unavailable. Supply the original source.",
      },
    }),
    text("<summary>Source access is blocked.</summary>"),
  ]);
  const h = await fixture(worker, [
    call("worker", { operation: "start", assignment }),
    text("Робота триває."),
    text("Джерело недоступне."),
  ]);
  await h.session.send({
    type: "run",
    prompt: "Поясни надане джерело. Пиши українською. Не вигадуй фактів.",
  });
  await until(
    () =>
      latest(h.events)?.type === "worker.acceptance" &&
      latest(h.events)?.acceptance.phase === "unconfirmed",
  );
  await h.session.flush();
  await h.session.dispose();
  const before = latest(h.stored);
  const resumedWorker = scriptedProvider([text("<summary>Still blocked.</summary>")]);
  const resumedTalker = scriptedProvider([
    call("worker", { operation: "resume" }),
    text("<summary><p>Finished.</p></summary>"),
  ]);
  const restored = await createConversation(h.options, {
    events: h.stored,
    configure: async (options, execute) => {
      const roles = await conversationOptions(options, h.config, [], execute);
      return {
        talker: { ...roles.talker, provider: resumedTalker },
        worker: { ...roles.worker, provider: resumedWorker },
      };
    },
  });
  fixtures.push({ cwd: h.cwd, session: restored });
  const events: Event[] = [];
  restored.subscribe((event) => events.push(event));
  await restored.send({ type: "run", prompt: "Продовжуй перевірку без зміни критеріїв." });
  await until(() => resumedWorker.requests.length > 0);
  expect(resumedWorker.requests[0]?.messages.at(-1)?.content).toContain("source: blocked");
  expect(events.some((event) => event.type === "message.finished" && event.complete)).toBe(false);
  const after = latest(events);
  if (before?.type !== "worker.acceptance" || after?.type !== "worker.acceptance")
    throw new Error("Missing resumed ledger");
  expect(after.acceptance.taskId).toBe(before.acceptance.taskId);
  expect(after.acceptance.assignment).toEqual(assignment);
  expect(after.acceptance.criteria[0]?.status).toBe("blocked");
  expect(after.acceptance.criteria[1]?.status).toBe("open");
});
