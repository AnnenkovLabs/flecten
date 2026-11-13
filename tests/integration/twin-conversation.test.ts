import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversation } from "../../src/app/conversation";
import { conversationOptions } from "../../src/app/conversation-options";
import { projectTwin } from "../../src/app/twin";
import { HarnessConfigSchema } from "../../src/config/schema";
import type { Event } from "../../src/core/types";
import type { ModelEvent, ModelProvider, ModelRequest } from "../../src/providers/types";
import { loadSessionMedia, saveSessionMedia } from "../../src/store/attachments";
import { pageSink } from "../../src/store/pages";
import { sessionPaths } from "../../src/store/paths";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const limits = {
  maxOutputBytes: 20000,
  maxOutputLines: 500,
  bashTimeoutMs: 1000,
  readLimitLines: 500,
};
const end = (text: string): ModelEvent[] => [
  { type: "text", delta: text },
  { type: "usage", input: 100, output: 20, cached: 0 },
  { type: "done", reason: "end" },
];
const call = (id: string, name: string, args: unknown): ModelEvent[] => [
  { type: "tool_call", id, name, args },
  { type: "done", reason: "tool_use" },
];

async function fixture(
  options: {
    alwaysReject?: boolean;
    holdPrepare?: boolean;
    holdFinal?: boolean;
    stage?: boolean;
    visual?: boolean;
  } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), "twin-conversation-"));
  if (options.visual)
    await Bun.write(
      join(cwd, "checkout.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
  const requests: ModelRequest[] = [];
  const events: Event[] = [];
  const prepared = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const accepted = Promise.withResolvers<void>();
  const reviewing = Promise.withResolvers<void>();
  let workerTurn = 0;
  let finalReviews = 0;
  const provider: ModelProvider = {
    id: "twin-test",
    model: "twin-test",
    async *stream(request, signal) {
      requests.push(structuredClone(request));
      let script: ModelEvent[];
      if (request.system.includes("# Twin:")) {
        const text = request.messages[0]?.content ?? "";
        const phase = text.includes('"phase":"prepare"')
          ? "prepare"
          : text.includes('"phase":"question"')
            ? "question"
            : text.includes('"phase":"checkpoint"')
              ? "checkpoint"
              : "final";
        if (phase === "prepare") {
          prepared.resolve();
          if (options.holdPrepare)
            await Promise.race([
              release.promise,
              new Promise<void>((resolve) =>
                signal?.addEventListener("abort", () => resolve(), { once: true }),
              ),
            ]);
        }
        if (phase === "final" && options.holdFinal && finalReviews === 0) {
          reviewing.resolve();
          await Promise.race([
            release.promise,
            new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true }),
            ),
          ]);
          finalReviews++;
        }
        if (signal?.aborted) return;
        const reject =
          phase === "checkpoint" ||
          (phase === "final" && !options.stage && (++finalReviews === 1 || options.alwaysReject));
        script = end(
          JSON.stringify({
            verdict: reject || phase === "prepare" ? "revise" : "pass",
            voice: reject
              ? "Меня бесит эта регистрация. Убери её."
              : "Хочу один экран без регистрации.",
            instructions:
              phase === "question"
                ? "Use a single checkout screen."
                : "Preserve one screen and remove registration.",
            entryIds: [],
            emotion: reject ? "angry" : "calm",
          }),
        );
      } else if (!request.tools.length) {
        script = end(
          JSON.stringify({
            progress: "Checkout page saved.",
            locations: "checkout.txt",
            instructions: "Preserve one screen.",
            nextSteps: "Review checkout.",
            risks: "No errors.",
          }),
        );
      } else if (request.tools.some((tool) => tool.name === "worker")) {
        const alreadyStarted = request.messages.some(
          (message) => message.role === "tool" && message.name === "worker",
        );
        script = alreadyStarted
          ? end("Working in background.")
          : call("start", "worker", { operation: "start", task: "Implement checkout." });
      } else if (options.stage || options.visual) {
        const stages = [
          call("begin", "context", { op: "begin", title: "Checkout", objective: "Build checkout" }),
          call("save", "write", { path: "checkout.txt", content: "One screen. No registration." }),
          ...(options.visual ? [call("inspect", "read", { path: "checkout.png" })] : []),
          call("complete", "context", {
            op: "complete",
            summary: "Checkout saved",
            evidence: ["checkout.txt saved"],
            next: "Review checkout",
          }),
          end("<summary>Checkout verified.</summary>"),
        ];
        script = stages[workerTurn++] ?? end("<summary>Checkout verified.</summary>");
      } else {
        switch (workerTurn++) {
          case 0:
            script = call("question", "ask", {
              question: "How many screens?",
              options: ["One", "Two"],
            });
            break;
          case 1:
            script = call("bad", "write", {
              path: "checkout.txt",
              content: "Registration required",
            });
            break;
          case 2:
            script = end("<summary>Checkout created with registration.</summary>");
            break;
          case 3:
            script = call("read-first", "read", { path: "checkout.txt" });
            break;
          case 4:
            script = call("fixed", "write", {
              path: "checkout.txt",
              content: "One screen. No registration.",
            });
            break;
          default:
            script = end(
              "<summary>One checkout screen, no registration. Verified checkout.txt.</summary>",
            );
        }
      }
      for (const event of script) yield event;
    },
  };
  const twin = await projectTwin({
    cwd,
    home: cwd,
    secrets: () => [],
    target: () => ({ provider, providerId: "twin-test", model: "twin-test", price: () => 0.001 }),
  });
  await twin.configure({ enabled: true });
  const config = HarnessConfigSchema.parse({
    useDefaults: false,
    provider: "twin-test",
    model: "twin-test",
  });
  const conversation = await createConversation(
    {
      cwd,
      sessionId: "clone",
      provider,
      providerId: "twin-test",
      model: "twin-test",
      tools: new ToolRegistry(builtinTools(), { limits }),
      system: "test",
      limits,
      maxOutputTokens: 2000,
      context: { window: 64000, reserve: 2000 },
      loop: { maxTurns: 10, continuations: 0, parallelTools: false },
      price: () => 0.001,
      modalities: ["text", "image"],
      saveMedia: (id, parts) => saveSessionMedia(cwd, id, parts),
      loadMedia: (id, refs) => loadSessionMedia(cwd, id, refs),
      ...(options.stage || options.visual
        ? { pages: () => pageSink(sessionPaths(cwd, "clone_worker")) }
        : {}),
      logDir: () => join(cwd, "logs"),
      onEvent: (event) => {
        events.push(event);
        if (
          event.type === "twin.activity" &&
          event.activity.phase === "final" &&
          event.activity.state === "pass"
        )
          accepted.resolve();
      },
    },
    {
      events: [],
      twin,
      configure: (current, execute, answer) =>
        conversationOptions(current, config, [], execute, answer),
    },
  );
  cleanup.push(async () => {
    release.resolve();
    await conversation.dispose();
    await twin.dispose();
    await rm(cwd, { recursive: true, force: true });
  });
  return {
    cwd,
    conversation,
    requests,
    events,
    prepared,
    release,
    reviewing,
    accepted,
    get finalReviews() {
      return finalReviews;
    },
  };
}

async function within<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    Bun.sleep(4000).then(() => {
      throw new Error("Twin conversation timed out");
    }),
  ]);
}

test("Twin directs the real Worker, answers taste, and rejects its first deliverable before accepting the corrected file", async () => {
  const f = await fixture();
  await f.conversation.send({
    type: "run",
    sessionId: "clone",
    prompt: "Мне нужен один экран, регистрация бесит.",
  });
  await within(f.accepted.promise);
  expect(await readFile(join(f.cwd, "checkout.txt"), "utf8")).toBe("One screen. No registration.");
  expect(f.finalReviews).toBe(2);
  expect(
    f.events.some(
      (event) =>
        event.type === "twin.activity" &&
        event.activity.state === "revise" &&
        event.activity.emotion === "angry",
    ),
  ).toBe(true);
  const worker = f.requests.filter(
    (request) =>
      !request.tools.some((tool) => tool.name === "worker") && !request.system.includes("# Twin:"),
  );
  expect(worker[0]?.messages[0]?.content).toContain("Preserve one screen");
  expect(
    worker.some((request) =>
      request.messages.some(
        (message) =>
          message.role === "tool" &&
          message.name === "ask" &&
          message.content.includes("Use a single checkout screen"),
      ),
    ),
  ).toBe(true);
  expect(
    f.events.some(
      (event) =>
        event.type === "twin.activity" &&
        event.activity.phase === "final" &&
        event.activity.usage?.costUsd === 0.001,
    ),
  ).toBe(true);
});

test("Stopping during Twin preparation cancels the review and prevents a delayed Worker start", async () => {
  const f = await fixture({ holdPrepare: true });
  await f.conversation.send({ type: "run", sessionId: "clone", prompt: "Build checkout" });
  await within(f.prepared.promise);
  await f.conversation.send({ type: "stop", target: "worker", mode: "force" });
  await f.conversation.flush();
  expect(
    f.events.some(
      (event) => event.type === "worker.event" && event.event.type === "session.started",
    ),
  ).toBe(false);
});

test("Twin bounds repeated rejection at four automatic returns and does not claim acceptance", async () => {
  const f = await fixture({ alwaysReject: true });
  await f.conversation.send({ type: "run", sessionId: "clone", prompt: "Build checkout" });
  const start = Date.now();
  while (f.finalReviews < 5 && Date.now() - start < 4000) await Bun.sleep(10);
  expect(f.finalReviews).toBe(5);
  expect(
    f.events.filter(
      (event) => event.type === "worker.event" && event.event.type === "session.started",
    ),
  ).toHaveLength(5);
  expect(
    f.events.some(
      (event) =>
        event.type === "twin.activity" &&
        event.activity.phase === "final" &&
        event.activity.state === "pass",
    ),
  ).toBe(false);
});

test("Twin reviews a completed semantic page before the next Worker request", async () => {
  const f = await fixture({ stage: true });
  await f.conversation.send({
    type: "run",
    sessionId: "clone",
    prompt: "Build one checkout screen",
  });
  await within(f.accepted.promise);
  const checkpoint = f.events.findIndex(
    (event) =>
      event.type === "twin.activity" &&
      event.activity.phase === "checkpoint" &&
      event.activity.state === "revise",
  );
  expect(checkpoint).toBeGreaterThan(0);
  expect(
    f.requests.some(
      (request) =>
        request.tools.some((tool) => tool.name === "context") &&
        request.messages.some(
          (message) =>
            message.content.includes("Twin speaking for the user") &&
            message.content.includes("remove registration"),
        ),
    ),
  ).toBe(true);
});

test("A fresh human instruction retires an in-flight verdict and is included in the next acceptance", async () => {
  const f = await fixture({ holdFinal: true });
  await f.conversation.send({ type: "run", sessionId: "clone", prompt: "Build checkout" });
  await within(f.reviewing.promise);
  const fresh = "Теперь без формы email, это новая инструкция.";
  await f.conversation.send({ type: "run", sessionId: "clone", prompt: fresh });
  await within(f.accepted.promise);
  const reviews = f.requests.filter(
    (request) =>
      request.system.includes("# Twin:") &&
      request.messages.some((message) => message.content.includes('"phase":"final"')),
  );
  expect(reviews.at(-1)?.messages[0]?.content).toContain(fresh);
  expect(
    f.events.some(
      (event) => event.type === "twin.activity" && event.activity.state === "cancelled",
    ),
  ).toBe(true);
});

test("A new instruction during preparation is reviewed before Worker starts", async () => {
  const f = await fixture({ holdPrepare: true });
  await f.conversation.send({ type: "run", sessionId: "clone", prompt: "Build checkout" });
  await within(f.prepared.promise);
  const fresh = "Use the latest design, remove the email form.";
  const next = f.conversation.send({ type: "run", sessionId: "clone", prompt: fresh });
  f.release.resolve();
  await next;
  await within(f.accepted.promise);
  const preparations = f.requests.filter(
    (request) =>
      request.system.includes("# Twin:") &&
      request.messages.some((message) => message.content.includes('"phase":"prepare"')),
  );
  expect(preparations).toHaveLength(2);
  expect(preparations.at(-1)?.messages[0]?.content).toContain(fresh);
  const lastPrepare = f.events.findLastIndex(
    (event) => event.type === "twin.activity" && event.activity.phase === "prepare",
  );
  const workerStart = f.events.findIndex(
    (event) => event.type === "worker.event" && event.event.type === "session.started",
  );
  expect(workerStart).toBeGreaterThan(lastPrepare);
});

test("Twin receives actual pixels from the Worker's verified tool artifact in its final review", async () => {
  const f = await fixture({ stage: true, visual: true });
  await f.conversation.send({
    type: "run",
    sessionId: "clone",
    prompt: "Review checkout visually",
  });
  await within(f.accepted.promise);
  const final = f.requests.find(
    (request) =>
      request.system.includes("# Twin:") &&
      request.messages[0]?.content.includes('"phase":"final"'),
  );
  const input = final?.messages[0];
  expect(input?.role).toBe("user");
  if (input?.role !== "user") throw new Error("Missing Twin image review");
  expect(input.images).toHaveLength(1);
  expect(input.images?.[0]?.mediaType).toBe("image/png");
  expect(Buffer.from(input.images?.[0]?.data ?? "", "base64")).toEqual(
    Buffer.from(await Bun.file(join(f.cwd, "checkout.png")).arrayBuffer()),
  );
  expect(input.content).not.toContain("iVBORw0KGgo");
});
