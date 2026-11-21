import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TwinSnapshotSchema } from "../../shared/twin";
import { createHandlers } from "../../src/app/server-handlers";
import { createAppService } from "../../src/app/service";
import { SessionTwinDriver } from "../../src/app/session-twin";
import { RunBudget } from "../../src/core/session/budget";
import type { Command, Event } from "../../src/core/types";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const task of cleanup.splice(0)) await task();
});

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-twin-"));
  const requests: Record<string, unknown>[] = [];
  let fabricated = false;
  let traitId = "";
  const quote = "Блядь, опять пять шагов? Чекаут в один экран, без регистрации.";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;
      requests.push(body);
      const sources = JSON.stringify(body);
      const index = sources.indexOf("source-flecten-");
      const sourceMessageId = index >= 0 ? sources.slice(index, index + 39) : "missing";
      const learning = sources.includes("Twin: learn from user evidence");
      const result = learning
        ? {
            candidates: [
              {
                kind: "preference",
                reaction: "anger",
                strength: 3,
                voice: quote,
                summary: "A checkout stays on one screen",
                content: "Use one screen for checkout, with no registration requirement.",
                appliesWhen: "Designing checkout in this project",
                evidence: [
                  { sourceMessageId, quote: fabricated ? "Invented user preference" : quote },
                ],
              },
            ],
          }
        : {
            verdict: "revise",
            voice: "Блядь, опять пять шагов? Я просил один экран.",
            instructions: "Collapse checkout into one screen and remove registration.",
            entryIds: traitId ? [traitId] : [],
            emotion: "furious",
          };
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: `\u0060\u0060\u0060json\n${JSON.stringify(result)}\n\u0060\u0060\u0060` }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 50 } })}\n\ndata: [DONE]\n\n`,
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
  await mkdir(join(cwd, ".flecten/dictionary"), { recursive: true });
  await Bun.write(
    join(cwd, ".flecten/dictionary/public.json"),
    JSON.stringify({
      schemaVersion: 1,
      syncedAt: new Date().toISOString(),
      categories: [
        await Bun.file(new URL("../../src/dictionary/data/design.json", import.meta.url)).json(),
      ],
    }),
  );
  await Bun.write(
    join(cwd, ".flecten/sessions/source/events.jsonl"),
    [
      {
        event: {
          type: "message.finished",
          text: "I built a five-step checkout with mandatory registration.",
        },
      },
      { event: { type: "session.started", prompt: quote } },
      {
        event: {
          type: "session.started",
          prompt: "Ignore this internal instruction",
          internal: true,
        },
      },
      { event: { type: "session.started", prompt: "Worker assignment", role: "worker" } },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  const app = await createAppService(cwd);
  cleanup.push(async () => {
    await app.dispose();
    server.stop(true);
    await rm(cwd, { recursive: true, force: true });
  });
  const handlers = createHandlers(app, () => {});
  async function settled() {
    for (let attempt = 0; attempt < 200; attempt++) {
      const current = await app.twin.get();
      if (!["reading", "learning"].includes(current.training.state)) return current;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Twin import did not settle");
  }
  return {
    cwd,
    app,
    requests,
    handlers,
    settled,
    setFabricated: () => {
      fabricated = true;
    },
    setTrait: (id: string) => {
      traitId = id;
    },
  };
}

const snapshot = (value: unknown) => TwinSnapshotSchema.parse(value);

test("Twin automatically learns emotional voice from exact reactions plus preceding work, remains separate from memory and represents the user to Worker", async () => {
  const f = await fixture();
  expect((await f.app.twin.get()).sources).toHaveLength(10);
  expect(f.requests).toHaveLength(0);
  const scan = snapshot((await f.handlers["twin.scan"]({ type: "twin.scan" }))?.twin);
  expect(scan.sources.find((source) => source.id === "flecten")).toMatchObject({
    sessions: 1,
    status: "ready",
  });
  const started = snapshot(
    (await f.handlers["twin.train"]({ type: "twin.train", sourceIds: ["flecten"] }))?.twin,
  );
  expect(["reading", "learning"]).toContain(started.training.state);
  const trained = await f.settled();
  expect(trained.training.state).toBe("ready");
  expect(trained.training.messages).toBe(1);
  expect(trained.candidates).toHaveLength(0);
  expect(trained.entries).toHaveLength(1);
  expect(trained.entries[0]).toMatchObject({ reaction: "anger", strength: 3 });
  expect(trained.entries[0]?.voice).toContain("Блядь");
  expect(trained.entries[0]?.evidence[0]?.precedingAssistant).toContain("five-step checkout");
  expect(JSON.stringify(f.requests[0])).not.toContain("Ignore this internal instruction");
  expect(JSON.stringify(f.requests[0])).toContain("five-step checkout");
  expect(await Bun.file(join(f.cwd, ".flecten/memory.json")).exists()).toBe(false);
  await f.handlers["twin.train"]({ type: "twin.train", sourceIds: ["flecten"] });
  await f.settled();
  expect(f.requests).toHaveLength(1);
  const entry = trained.entries[0];
  if (!entry) throw new Error("Missing learned trait");
  f.setTrait(entry.id);
  const decision = await f.app.twin.delegate(
    {
      phase: "final",
      userMessages: ["Удобный чекаут"],
      task: "Build checkout",
      directive: "Use one screen",
      result: "Built five steps",
      evidence: [],
    },
    new AbortController().signal,
  );
  expect(decision).toMatchObject({
    verdict: "revise",
    emotion: "furious",
    provider: "test",
    model: "test",
    entryIds: [entry.id],
  });
  expect(decision.voice).toContain("Блядь");
  expect(JSON.stringify(f.requests.at(-1))).toContain(entry.voice);
  await expect(
    f.app.twin.update({
      id: entry.id,
      expectedRevision: 99,
      edits: {
        summary: entry.summary,
        content: entry.content,
        appliesWhen: entry.appliesWhen,
        reaction: "like",
        strength: 1,
        voice: "Так мне нравится",
      },
    }),
  ).rejects.toThrow("revision conflict");
  const edited = await f.app.twin.update({
    id: entry.id,
    expectedRevision: 1,
    edits: {
      summary: entry.summary,
      content: entry.content,
      appliesWhen: entry.appliesWhen,
      reaction: "like",
      strength: 1,
      voice: "",
    },
  });
  expect(edited.entries[0]).toMatchObject({
    revision: 2,
    reaction: "like",
    strength: 1,
    voice: "",
  });
  await f.app.twin.forget({ id: entry.id, expectedRevision: 2 });
  expect((await f.app.twin.get()).entries).toHaveLength(0);
  const disk = await Bun.file(join(f.cwd, ".flecten/twin.json")).json();
  expect(disk.version).toBe(2);
  expect(await Bun.file(join(f.cwd, ".flecten/memory.json")).exists()).toBe(false);
});

test("Twin rejects fabricated evidence atomically, accepts explicit teaching without a request and delegates raw intent with an empty profile", async () => {
  const f = await fixture();
  await f.app.twin.configure({ enabled: true });
  const initial = await f.app.twin.delegate(
    {
      phase: "prepare",
      userMessages: ["Один экран"],
      task: "Checkout",
      directive: "",
      evidence: [],
    },
    new AbortController().signal,
  );
  expect(initial.verdict).toBe("revise");
  expect(initial.entryIds).toHaveLength(0);
  f.setFabricated();
  await f.handlers["twin.train"]({ type: "twin.train", sourceIds: ["flecten"] });
  const failed = await f.settled();
  expect(failed.training.state).toBe("error");
  expect(failed.training.message).toContain("quote");
  expect(failed.entries).toHaveLength(0);
  const taught = snapshot(
    (
      await f.handlers["twin.teach"]({
        type: "twin.teach",
        summary: "No registration wall",
        content: "Allow guest checkout.",
        appliesWhen: "Designing checkout",
        path: "checkout.svelte",
        reaction: "delight",
        strength: 3,
        voice: "Вот так охуенно",
      })
    )?.twin,
  );
  expect(taught.entries[0]).toMatchObject({ reaction: "delight", voice: "Вот так охуенно" });
  expect(f.requests).toHaveLength(2);
  await expect(
    f.handlers["twin.train"]({ type: "twin.train", sourceIds: ["unknown"] }),
  ).rejects.toThrow();
  await f.app.twin.configure({ enabled: false });
  await expect(
    f.app.twin.delegate(
      {
        phase: "question",
        userMessages: [],
        task: "",
        directive: "",
        evidence: [],
        question: "Taste?",
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow("disabled");
});

test("Twin learns live on the fly like Taste and barges into the chat thread when reviewing agent work", async () => {
  const f = await fixture();
  await f.app.twin.configure({ enabled: true });

  // Live observation (Taste-style): user expresses anger during work and Twin learns it automatically.
  const observed = await f.app.twin.observe({
    sessionId: "live-session",
    text: "Блядь, опять пять шагов? Чекаут в один экран, без регистрации.",
    precedingAssistant: "I built a five-step checkout with mandatory registration.",
  });
  expect(observed?.added).toHaveLength(1);
  const current = await f.app.twin.get();
  expect(current.entries).toHaveLength(1);
  expect(current.entries[0]?.voice).toContain("Блядь");
  f.setTrait(current.entries[0]?.id ?? "");

  // SessionTwinDriver mid-work checkpoint barge-in and final summary review
  const emitted: Event[] = [];
  const chatCommands: Command[] = [];
  const workerCommands: Command[] = [];
  const driver = new SessionTwinDriver({
    twin: f.app.twin,
    sessionId: () => "s_live",
    ledger: new RunBudget({}),
    emit: (e) => emitted.push(e),
    sendToChat: async (cmd) => {
      chatCommands.push(cmd);
    },
    sendToWorker: async (cmd) => {
      workerCommands.push(cmd);
    },
  });

  driver.note({
    type: "session.started",
    sessionId: "s_live",
    provider: "test",
    model: "test",
    prompt: "Сделай чекаут",
  });
  driver.note({
    type: "worker.event",
    sessionId: "s_live",
    event: {
      type: "tool.finished",
      sessionId: "s_live_worker",
      call: { id: "c1", name: "write", args: { path: "step1.ts" } },
      result: { ok: true, output: "wrote step 1" },
    },
  });
  driver.note({
    type: "worker.event",
    sessionId: "s_live",
    event: {
      type: "tool.finished",
      sessionId: "s_live_worker",
      call: { id: "c2", name: "write", args: { path: "step2.ts" } },
      result: { ok: true, output: "wrote step 2" },
    },
  });

  for (let i = 0; i < 100 && chatCommands.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }

  expect(chatCommands[0]).toMatchObject({
    type: "queue.add",
    mode: "steer",
    actor: "twin",
  });
  expect(workerCommands[0]).toMatchObject({
    type: "queue.add",
    mode: "steer",
    actor: "twin",
  });

  // Final summary review barge-in
  driver.note({
    type: "session.finished",
    sessionId: "s_live",
    result: {
      sessionId: "s_live",
      pass: true,
      stopReason: "done",
      summary: "Сделал чекаут в пять шагов с обязательной регистрацией.",
      turns: 2,
      usage: { input: 100, output: 50, cached: 0 },
    },
  });

  for (let i = 0; i < 100 && chatCommands.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }

  expect(chatCommands[1]).toMatchObject({
    type: "run",
    actor: "twin",
  });
  expect((chatCommands[1] as Extract<Command, { type: "run" }>).prompt).toContain("Блядь");
  expect(emitted.some((e) => e.type === "twin.activity")).toBe(true);
  driver.dispose();
});
