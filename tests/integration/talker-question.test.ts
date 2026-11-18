import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversation } from "../../src/app/conversation";
import { conversationOptions } from "../../src/app/conversation-options";
import { HarnessConfigSchema } from "../../src/config/schema";
import type { SessionOptions } from "../../src/core/session/options";
import type { Event } from "../../src/core/types";
import type { ModelEvent, ModelProvider, ModelRequest } from "../../src/providers/types";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import { abortable } from "../../src/util/abort";
import { scriptedProvider } from "../helpers/fake-provider";

const text = (delta: string): ModelEvent[] => [
  { type: "text", delta },
  { type: "done", reason: "end" },
];
const call = (id: string, name: string, args: unknown): ModelEvent[] => [
  { type: "tool_call", id, name, args },
  { type: "done", reason: "tool_use" },
];

test("a Worker can clarify the chat while the Talker is responding and cancel its own question", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "flecten-talker-question-"));
  const config = HarnessConfigSchema.parse({ useDefaults: false, catalog: { autoRefresh: false } });
  const human = "Посмотри на макет. Цвет оставь медным.";
  const response = "Keep the copper color.";
  const streaming = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<AbortSignal>();
  const interrupted = Promise.withResolvers<void>();
  const questionRequests: ModelRequest[] = [];
  const ordinaryRequests: ModelRequest[] = [];
  const workerScript = scriptedProvider([
    call("first", "ask_talker", { question: "Which color did the user want to keep?" }),
    call("second", "ask_talker", { question: "Was there a preferred size?" }),
    call("verify", "criterion", {
      operation: "report",
      report: {
        criterionId: "result",
        status: "met",
        evidence: { kind: "tool_result", callId: "first", statement: response },
      },
    }),
    text("<summary>Inspected the requested layout.</summary>"),
  ]);
  const worker: ModelProvider = {
    ...workerScript,
    async *stream(request, signal) {
      await abortable(streaming.promise, signal);
      yield* workerScript.stream(request, signal);
    },
  };
  const talker: ModelProvider = {
    id: "talker",
    model: "talker",
    async *stream(request, signal) {
      if (request.system.startsWith("# Answer a Worker question")) {
        questionRequests.push(structuredClone(request));
        if (questionRequests.length === 1) {
          yield { type: "usage", input: 47, output: 6, cached: 0 };
          yield* text(response);
        } else {
          waiting.resolve(signal);
          try {
            await abortable(release.promise, signal);
          } finally {
            interrupted.resolve();
          }
        }
        return;
      }
      ordinaryRequests.push(structuredClone(request));
      if (ordinaryRequests.length === 1) {
        yield* call("start", "worker", { operation: "start", task: "Inspect the layout." });
        return;
      }
      if (ordinaryRequests.length === 2) {
        yield { type: "text", delta: "Смотрю" };
        streaming.resolve();
        await abortable(release.promise, signal);
        yield* text(" макет.");
        return;
      }
      yield* text("Проверил макет.");
    },
  };
  const options: SessionOptions = {
    cwd,
    sessionId: "question",
    provider: talker,
    providerId: "talker",
    model: "talker",
    tools: new ToolRegistry(builtinTools(), { limits: config.tools }),
    system: "unused",
    limits: config.tools,
    maxOutputTokens: 2000,
    context: { window: 100_000, reserve: 2000 },
    loop: config.loop,
    logDir: (id) => join(cwd, id, "logs"),
  };
  const session = await createConversation(options, {
    events: [],
    configure: async (current, execute) => {
      const roles = await conversationOptions(current, config, [], execute);
      return { ...roles, worker: { ...roles.worker, provider: worker } };
    },
  });
  const events: Event[] = [];
  const pending = Promise.withResolvers<string>();
  const done = Promise.withResolvers<void>();
  let questions = 0;
  session.subscribe((event) => {
    events.push(event);
    if (event.type !== "worker.event") return;
    const child = event.event;
    if (child.type === "tool.started" && child.call.name === "ask_talker" && ++questions === 2)
      pending.resolve(child.call.id);
    if (child.type === "session.finished") done.resolve();
  });
  const main = session.send({ type: "run", prompt: human });
  try {
    const [callId, signal] = await Promise.all([pending.promise, waiting.promise]);
    expect(session.peek().running).toBe(true);
    expect(questionRequests[0]?.tools).toEqual([]);
    expect(questionRequests[0]?.messages[0]).toMatchObject({ role: "user", content: human });
    expect(await session.send({ type: "status" })).toMatchObject({
      taskBudget: { spent: { tokens: 53 } },
    });
    expect(ordinaryRequests[0]?.tools.some(({ name }) => name === "ask_talker")).toBe(false);
    expect(workerScript.requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      name: "ask_talker",
      content: expect.stringContaining(response),
    });
    expect(
      workerScript.requests[1]?.messages.some(
        (message) => message.role === "user" && message.content.includes(human),
      ),
    ).toBe(false);
    expect(await session.send({ type: "tool.cancel", callId })).toEqual({ cancelled: true });
    await interrupted.promise;
    expect(signal.aborted).toBe(true);
    expect(session.peek().running).toBe(true);
    release.resolve();
    await Promise.all([main, done.promise]);
    expect(
      events.filter((event) => event.type === "message.finished").map((event) => event.text),
    ).toContain("Смотрю макет.");
    expect(
      events.some((event) => event.type === "message.finished" && event.text === response),
    ).toBe(false);
    expect(
      events
        .flatMap((event) =>
          event.type === "worker.event" && event.event.type === "tool.finished"
            ? [event.event]
            : [],
        )
        .find(({ call }) => call.name === "criterion")?.result,
    ).toMatchObject({
      ok: false,
      error: "Evidence must reference a successful tool result from this assignment",
    });
  } finally {
    release.resolve();
    await session.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
}, 10_000);
