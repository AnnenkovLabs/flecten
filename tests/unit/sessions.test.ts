import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppService } from "../../src/app/service";
import { createSession } from "../../src/core/session/session";
import type { Event, RunResult } from "../../src/core/types";
import { listSessions, readSession } from "../../src/store/events/read";
import { sessionPaths } from "../../src/store/paths";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { appendEvent } from "../helpers/append-event";
import { scriptedProvider } from "../helpers/fake-provider";

const limits = {
  maxOutputBytes: 50_000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10_000,
  readLimitLines: 2000,
};

describe("session history", () => {
  test("lists and reopens a saved chat", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "liquid-history-"));
    try {
      const paths = sessionPaths(cwd, "s-saved");
      const events: Event[] = [
        {
          type: "session.started",
          sessionId: "s-saved",
          provider: "test",
          model: "test-model",
          prompt: "Сохрани этот чат",
        },
        {
          type: "message.finished",
          sessionId: "s-saved",
          text: "Чат сохранён",
          reasoning: "",
          toolCalls: [],
        },
        {
          type: "hook.finished",
          sessionId: "s-saved",
          hook: {
            event: "sessionStart",
            index: 0,
            ok: true,
            decision: "allow",
            durationMs: 4,
            output: "hook output",
          },
        },
        // A reopened task shows its context meter from this stored reading, before any request.
        {
          type: "context.usage",
          sessionId: "s-saved",
          used: 41_200,
          window: 200_000,
          reserve: 16_000,
          source: "provider",
        },
        {
          type: "session.finished",
          sessionId: "s-saved",
          result: {
            sessionId: "s-saved",
            pass: false,
            stopReason: "end",
            summary: "Чат сохранён",
            turns: 1,
            usage: { input: 3, output: 2, cached: 0 },
          },
        },
      ];
      for (const event of events) await appendEvent(paths.events, event);

      expect(await listSessions(cwd)).toEqual([
        expect.objectContaining({ id: "s-saved", title: "Сохрани этот чат", stopReason: "end" }),
      ]);
      expect(await readSession(cwd, "s-saved")).toEqual(events);

      const service = await createAppService(cwd);
      expect(await service.listSessions()).toEqual([
        expect.objectContaining({ id: "s-saved", title: "Сохрани этот чат" }),
      ]);
      expect(await service.readSession("s-saved")).toEqual(events);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("continues the same session across messages", async () => {
    const provider = scriptedProvider([
      [
        { type: "text", delta: "first answer" },
        { type: "done", reason: "end" },
      ],
      [
        { type: "text", delta: "second answer" },
        { type: "done", reason: "end" },
      ],
    ]);
    const cwd = await mkdtemp(join(tmpdir(), "liquid-continuity-"));
    try {
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
        loop: { maxTurns: 4, continuations: 0, parallelTools: false },
        logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
      });

      const first = (await session.send({ type: "run", prompt: "first" })) as RunResult;
      const second = (await session.send({
        type: "run",
        prompt: "second",
        sessionId: first.sessionId,
      })) as RunResult;

      expect(second.sessionId).toBe(first.sessionId);
      expect(provider.requests[1]?.messages).toEqual([
        { role: "user", content: "first", memorySource: "first" },
        { role: "assistant", content: "first answer", reasoning: "", toolCalls: [] },
        { role: "user", content: "second", memorySource: "second" },
      ]);
      expect(session.getHistory().length).toBe(4);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("tells the window which fallback model answered", async () => {
    const provider = scriptedProvider([
      [
        { type: "route", provider: "backup", model: "b-model", reason: "rate_limit" },
        { type: "text", delta: "fallback answer" },
        { type: "done", reason: "end" },
      ],
    ]);
    const cwd = await mkdtemp(join(tmpdir(), "liquid-fallback-"));
    try {
      const events: Event[] = [];
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
        loop: { maxTurns: 4, continuations: 0, parallelTools: false },
        logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
      });
      session.subscribe((event) => events.push(event));

      const result = (await session.send({ type: "run", prompt: "hi" })) as RunResult;

      const fallback: Event = {
        type: "model.fallback",
        sessionId: result.sessionId,
        provider: "backup",
        model: "b-model",
        reason: "rate_limit",
      };
      expect(events).toContainEqual(fallback);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("treats a trailing summary block as completion without a done tool", async () => {
    const provider = scriptedProvider([
      [
        { type: "text", delta: "<summary><b>Ready.</b></summary>" },
        { type: "done", reason: "end" },
      ],
    ]);
    const cwd = await mkdtemp(join(tmpdir(), "liquid-summary-"));
    try {
      const events: Event[] = [];
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
        loop: { maxTurns: 4, continuations: 0, parallelTools: false },
        logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
      });
      session.subscribe((event) => events.push(event));

      const result = (await session.send({ type: "run", prompt: "finish" })) as RunResult;

      expect(result.stopReason).toBe("done");
      expect(result.summary).toBe("<b>Ready.</b>");
      const finished = events.find(
        (event) => event.type === "message.finished" && event.complete === true,
      );
      expect(finished).toMatchObject({ complete: true, summary: "<b>Ready.</b>" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("keeps reasoning and the interactive summary in the next request", async () => {
    const provider = scriptedProvider([
      [
        { type: "reasoning", delta: "check the edge" },
        { type: "text", delta: "answer<summary><b>done</b></summary>" },
        { type: "done", reason: "end" },
      ],
      [
        { type: "text", delta: "next" },
        { type: "done", reason: "end" },
      ],
    ]);
    const cwd = await mkdtemp(join(tmpdir(), "liquid-summary-context-"));
    try {
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
        loop: { maxTurns: 4, continuations: 0, parallelTools: false },
        logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
      });

      const first = (await session.send({ type: "run", prompt: "first" })) as RunResult;
      await session.send({ type: "run", prompt: "second", sessionId: first.sessionId });

      expect(provider.requests[1]?.messages).toEqual([
        { role: "user", content: "first", memorySource: "first" },
        {
          role: "assistant",
          content: "answer<summary><b>done</b></summary>",
          reasoning: "check the edge",
          toolCalls: [],
        },
        { role: "user", content: "second", memorySource: "second" },
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("passes image attachments into the user message", async () => {
    const provider = scriptedProvider([
      [
        { type: "text", delta: "seen" },
        { type: "done", reason: "end" },
      ],
    ]);
    const cwd = await mkdtemp(join(tmpdir(), "liquid-image-"));
    try {
      const image = join(cwd, "pixel.png");
      await Bun.write(
        image,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      );
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
        loop: { maxTurns: 4, continuations: 0, parallelTools: false },
        logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
      });

      await session.send({ type: "run", prompt: "look", attachments: [image] });

      const first = provider.requests[0]?.messages[0];
      expect(first?.role).toBe("user");
      expect(first && "images" in first ? first.images?.length : 0).toBe(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("loads history when resuming a saved session", async () => {
    const provider = scriptedProvider([
      [
        { type: "text", delta: "continued" },
        { type: "done", reason: "end" },
      ],
    ]);
    const cwd = await mkdtemp(join(tmpdir(), "liquid-resume-"));
    try {
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
        loop: { maxTurns: 4, continuations: 0, parallelTools: false },
        logDir: (id) => join(cwd, ".liquid", "sessions", id, "logs"),
        loadHistory: async () => [
          { role: "user", content: "prior" },
          { role: "assistant", content: "prior answer", reasoning: "", toolCalls: [] },
        ],
      });

      await session.send({ type: "run", prompt: "next", sessionId: "s-saved" });

      expect(provider.requests[0]?.messages).toEqual([
        { role: "user", content: "prior" },
        { role: "assistant", content: "prior answer", reasoning: "", toolCalls: [] },
        { role: "user", content: "next", memorySource: "next" },
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
