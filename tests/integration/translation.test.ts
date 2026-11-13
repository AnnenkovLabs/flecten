import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrompt } from "../../src/core/prompt";
import type { SessionOptions } from "../../src/core/session/options";
import { createSession } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import type { ModelEvent } from "../../src/providers/types";
import { readTolerant } from "../../src/store/events/envelope";
import { readSession } from "../../src/store/events/read";
import { replayMessages } from "../../src/store/events/replay";
import { sessionPaths } from "../../src/store/paths";
import { ToolRegistry } from "../../src/tools/registry";
import { TranslationClient } from "../../src/translation/client";
import { appendEvent } from "../helpers/append-event";
import { scriptedProvider } from "../helpers/fake-provider";

function translation(language: string, texts: string[]): ModelEvent[] {
  return [
    {
      type: "tool_call",
      id: "t",
      name: "translation_result",
      args: { sourceLanguage: language, allEnglish: language === "en", texts },
    },
    { type: "usage", input: 10, output: 5, cached: 0 },
    { type: "done", reason: "tool_use" },
  ];
}
const limits = {
  maxOutputBytes: 50000,
  maxOutputLines: 2000,
  bashTimeoutMs: 1000,
  readLimitLines: 100,
};

function sessionFor(provider: SessionOptions["provider"], translator: SessionOptions["provider"]) {
  return createSession({
    cwd: process.cwd(),
    provider,
    providerId: "worker",
    model: provider.model,
    system: "",
    tools: new ToolRegistry([], { limits }),
    limits,
    maxOutputTokens: 1000,
    context: { window: 10000, reserve: 1000 },
    loop: { maxTurns: 3, continuations: 0, parallelTools: true },
    logDir: () => "/tmp/flecten-translation-unused",
    language: {
      client: new TranslationClient(translator, 1000),
      language: "auto",
      price: () => 0,
      providerId: "t",
    },
  });
}
const answer: ModelEvent[] = [
  { type: "text", delta: "<summary>Fixed.</summary>" },
  { type: "done", reason: "end" },
];

describe("translated session", () => {
  test("the built-in system stays unchanged and only changed project instructions are translated", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-system-translation-"));
    const instructions = { managed: [], user: [], local: [], nested: false };
    const provider = scriptedProvider([
      [
        { type: "text", delta: "Ready." },
        { type: "done", reason: "end" },
      ],
      [
        { type: "text", delta: "Ready." },
        { type: "done", reason: "end" },
      ],
      [
        { type: "text", delta: "Ready." },
        { type: "done", reason: "end" },
      ],
    ]);
    const translator = scriptedProvider([
      translation("en", []),
      translation("ru", [
        "Instructions",
        "project instructions",
        `Source: ${cwd}/AGENTS.md`,
        "Keep the API.",
      ]),
      translation("ru", [
        "Instructions",
        "project instructions",
        `Source: ${cwd}/AGENTS.md`,
        "Keep the tests.",
      ]),
    ]);
    let session: ReturnType<typeof createSession> | undefined;
    try {
      await Bun.write(join(cwd, "AGENTS.md"), "Сохрани API.");
      const first = await buildPrompt(cwd, { instructions });
      session = createSession({
        cwd,
        provider,
        providerId: "worker",
        model: provider.model,
        system: first.system,
        systemParts: first.systemParts,
        tools: new ToolRegistry([], { limits }),
        limits,
        maxOutputTokens: 1000,
        context: { window: 100000, reserve: 1000 },
        loop: { maxTurns: 1, continuations: 0, parallelTools: true },
        logDir: () => "/tmp/flecten-translation-unused",
        language: {
          client: new TranslationClient(translator, 1000),
          language: "auto",
          price: () => 0,
          providerId: "t",
        },
      });
      await session.send({ type: "run", prompt: "Hello." });
      expect(translator.requests).toHaveLength(2);
      expect(translator.requests[1]?.messages[0]?.content).toContain("Сохрани API.");
      for (const part of first.systemParts.filter((part) => part.workingLanguage === "en")) {
        expect(provider.requests[0]?.system).toContain(part.text);
        expect(
          translator.requests.some((request) => request.messages[0]?.content.includes(part.text)),
        ).toBe(false);
      }
      expect(provider.requests[0]?.system).toContain("Keep the API.");
      expect(provider.requests[0]?.system).not.toContain("Сохрани API.");
      await session.send({ type: "run", prompt: "Hello." });
      expect(translator.requests).toHaveLength(2);
      await Bun.write(join(cwd, "AGENTS.md"), "Сохрани тесты.");
      const changed = await buildPrompt(cwd, { instructions });
      session.update({ system: changed.system, systemParts: changed.systemParts });
      await session.send({ type: "run", prompt: "Hello." });
      expect(translator.requests).toHaveLength(3);
      expect(provider.requests[2]?.system).toContain("Keep the tests.");
      expect(provider.requests[2]?.system).not.toContain("Сохрани тесты.");
    } finally {
      await session?.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("persists the original, displays Russian HTML and replays English model history", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "flecten-translation-"));
    const provider = scriptedProvider([
      [
        { type: "text", delta: "<summary><p>Fixed.</p></summary>" },
        { type: "usage", input: 100, output: 20, cached: 0 },
        { type: "done", reason: "end" },
      ],
    ]);
    const translator = scriptedProvider([
      translation("ru", ["Fix the bug."]),
      translation("en", ["Work carefully."]),
      translation("en", ["Исправлено."]),
    ]);
    const session = createSession({
      cwd,
      provider,
      providerId: "test",
      model: provider.model,
      system: "Work carefully.",
      tools: new ToolRegistry([], { limits }),
      limits,
      maxOutputTokens: 1000,
      context: { window: 10000, reserve: 1000 },
      loop: { maxTurns: 2, continuations: 0, parallelTools: true },
      price: () => 0.02,
      language: {
        client: new TranslationClient(translator, 1000),
        language: "auto",
        price: () => 0.001,
        providerId: "translator",
      },
      logDir: (id) => sessionPaths(cwd, id).logs,
      onEvent: (event) => {
        if (event.sessionId) return appendEvent(sessionPaths(cwd, event.sessionId).events, event);
      },
    });
    const events: Event[] = [];
    session.subscribe((event) => events.push(event));
    try {
      const result = (await session.send({ type: "run", prompt: "Исправь баг." })) as RunResult;
      await session.flush();
      expect(result.stopReason).toBe("done");
      expect(result.summary).toBe("<p>Исправлено.</p>");
      expect(result.usage).toEqual({ input: 130, output: 35, cached: 0 });
      expect(result.budget?.spent.costUsd).toBeCloseTo(0.023);
      expect(provider.requests[0]?.messages[0]?.content).toBe("Fix the bug.");
      expect(events.find((event) => event.type === "session.started")).toMatchObject({
        prompt: "Исправь баг.",
      });
      const finished = events.find((event) => event.type === "message.finished");
      expect(finished).toMatchObject({
        summary: "<p>Fixed.</p>",
        display: { summary: "<p>Исправлено.</p>" },
      });
      expect(
        events
          .filter((event) => event.type === "message.delta")
          .map((event) => event.text)
          .join(""),
      ).toBe("<summary><p>Исправлено.</p></summary>");
      const saved = await readSession(cwd, result.sessionId);
      expect(saved.find((event) => event.type === "message.finished")).toEqual(finished);
      const { envelopes } = await readTolerant(sessionPaths(cwd, result.sessionId).events);
      const history = replayMessages(envelopes).messages;
      expect(history[0]).toMatchObject({
        content: "Fix the bug.",
        workingLanguage: "en",
        sourceLanguage: "ru",
      });
      expect(history[1]).toMatchObject({
        content: "<summary><p>Fixed.</p></summary>",
        workingLanguage: "en",
      });
      expect(JSON.stringify(history)).not.toContain("Исправлено");
      expect(translator.requests).toHaveLength(3);
    } finally {
      await session.dispose();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("an invalid input translation never reaches the worker", async () => {
    const provider = scriptedProvider([]);
    const session = createSession({
      cwd: process.cwd(),
      provider,
      providerId: "test",
      model: provider.model,
      system: "",
      tools: new ToolRegistry([], { limits }),
      limits,
      maxOutputTokens: 1000,
      context: { window: 10000, reserve: 1000 },
      loop: { maxTurns: 1, continuations: 0, parallelTools: true },
      logDir: () => "/tmp/flecten-translation-unused",
      language: {
        client: new TranslationClient(scriptedProvider([translation("ru", [])]), 1000),
        language: "auto",
        price: () => 0,
        providerId: "t",
      },
    });
    try {
      const result = (await session.send({ type: "run", prompt: "Почини баг" })) as RunResult;
      expect(result.stopReason).toBe("error");
      expect(provider.requests).toHaveLength(0);
      expect(result.usage.input).toBe(10);
    } finally {
      await session.dispose();
    }
  });

  test("a system translation timeout reports the translator and never rejects the user's text", async () => {
    const provider = scriptedProvider([]);
    let calls = 0;
    const translator: SessionOptions["provider"] = {
      id: "translator",
      model: "slow-model",
      async *stream(_request, signal) {
        if (++calls === 1) {
          yield* translation("ru", ["Hi, how are you?"]);
          return;
        }
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        signal.throwIfAborted();
      },
    };
    const session = createSession({
      cwd: process.cwd(),
      provider,
      providerId: "worker",
      model: provider.model,
      system: "Work carefully.",
      tools: new ToolRegistry([], { limits }),
      limits,
      maxOutputTokens: 1000,
      context: { window: 10000, reserve: 1000 },
      loop: { maxTurns: 1, continuations: 0, parallelTools: true },
      logDir: () => "/tmp/flecten-translation-unused",
      language: {
        client: new TranslationClient(translator, 10),
        language: "auto",
        price: () => 0,
        providerId: "test-translator",
      },
    });
    const events: Event[] = [];
    session.subscribe((event) => events.push(event));
    try {
      const result = (await session.send({ type: "run", prompt: "привет как дела" })) as RunResult;
      expect(result.stopReason).toBe("error");
      expect(calls).toBe(2);
      expect(provider.requests).toHaveLength(0);
      expect(events.find((event) => event.type === "error")).toMatchObject({
        code: "provider_failed",
      });
      expect(result.summary).toContain("системные инструкции");
      expect(result.summary).toContain("test-translator / slow-model");
      expect(result.summary).toContain("0.01 с");
    } finally {
      await session.dispose();
    }
  });

  test("failed output shows the original with one notice and never reruns the worker", async () => {
    const provider = scriptedProvider([answer]);
    const translator = scriptedProvider([translation("ru", ["Fix it."]), translation("en", [])]);
    const session = sessionFor(provider, translator);
    const events: Event[] = [];
    session.subscribe((event) => events.push(event));
    try {
      const result = (await session.send({ type: "run", prompt: "Почини." })) as RunResult;
      expect(result.stopReason).toBe("done");
      expect(result.summary).toBe("Fixed.");
      expect(events.filter((event) => event.type === "translation.failed")).toHaveLength(1);
      expect(events.find((event) => event.type === "message.finished")).toMatchObject({
        display: { summary: "Fixed." },
      });
      expect(provider.requests).toHaveLength(1);
      expect(translator.requests).toHaveLength(2);
    } finally {
      await session.dispose();
    }
  });

  test("English prompts and answers pass through byte for byte after detection", async () => {
    const provider = scriptedProvider([answer]);
    const translator = scriptedProvider([translation("en", ["Do not rephrase me."])]);
    const session = sessionFor(provider, translator);
    try {
      const result = (await session.send({ type: "run", prompt: "Fix  it." })) as RunResult;
      expect(result.summary).toBe("Fixed.");
      expect(provider.requests[0]?.messages[0]?.content).toBe("Fix  it.");
      expect(translator.requests).toHaveLength(1);
    } finally {
      await session.dispose();
    }
  });

  for (const mode of ["input", "output"] as const)
    test(`force stop cancels ${mode} translation`, async () => {
      const started = Promise.withResolvers<void>();
      let call = 0;
      let cancelled = false;
      const translator: SessionOptions["provider"] = {
        id: "t",
        model: "t",
        async *stream(_request, signal) {
          call++;
          if (mode === "output" && call === 1) {
            yield* translation("ru", ["Fix it."]);
            return;
          }
          started.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener(
              "abort",
              () => {
                cancelled = true;
                resolve();
              },
              { once: true },
            ),
          );
          signal.throwIfAborted();
        },
      };
      const provider = scriptedProvider([answer]);
      const session = sessionFor(provider, translator);
      try {
        const running = session.send({ type: "run", prompt: "Почини." });
        await started.promise;
        await session.send({ type: "stop", mode: "force" });
        expect(((await running) as RunResult).stopReason).toBe("stopped");
        expect(cancelled).toBe(true);
        expect(provider.requests).toHaveLength(mode === "input" ? 0 : 1);
      } finally {
        await session.dispose();
      }
    });

  test("steering and queued prompts preserve originals and reach the worker in English", async () => {
    const provider = scriptedProvider([answer, answer]);
    const translator = scriptedProvider([
      translation("ru", ["Fix it."]),
      translation("ru", ["Keep the API."]),
      translation("en", ["Исправлено."]),
      translation("uk", ["Check tests."]),
      translation("en", ["Виправлено."]),
    ]);
    const session = sessionFor(provider, translator);
    const finished = Promise.withResolvers<void>();
    const events: Event[] = [];
    let runs = 0;
    session.subscribe((event) => {
      events.push(event);
      if (event.type === "session.finished" && ++runs === 2) finished.resolve();
      if (event.type === "input.translated" && runs === 0) {
        void session.send({ type: "queue.add", text: "Сохрани API.", mode: "steer" });
        void session.send({ type: "queue.add", text: "Перевір тести." });
      }
    });
    try {
      await session.send({ type: "run", prompt: "Почини." });
      await finished.promise;
      expect(provider.requests[0]?.messages.map((message) => message.content)).toEqual([
        "Fix it.",
        "Keep the API.",
      ]);
      expect(provider.requests[1]?.messages.at(-1)?.content).toBe("Check tests.");
      expect(events.find((event) => event.type === "steer.applied")).toMatchObject({
        text: "Сохрани API.",
        input: "Keep the API.",
      });
      expect(events.filter((event) => event.type === "session.started").at(-1)).toMatchObject({
        prompt: "Перевір тести.",
      });
      expect(events.filter((event) => event.type === "session.finished").at(-1)).toMatchObject({
        result: { summary: "Виправлено." },
      });
      expect(translator.requests).toHaveLength(5);
    } finally {
      await session.dispose();
    }
  });
});
