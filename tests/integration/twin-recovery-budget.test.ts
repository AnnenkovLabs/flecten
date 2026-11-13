import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversation } from "../../src/app/conversation";
import { conversationOptions } from "../../src/app/conversation-options";
import { projectTwin } from "../../src/app/twin";
import { HarnessConfigSchema } from "../../src/config/schema";
import type { BudgetLimits } from "../../src/core/session/budget";
import type { Event, RunResult } from "../../src/core/types";
import type { ModelEvent, ModelProvider, ModelRequest } from "../../src/providers/types";
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
const finish = (text: string, input = 10): ModelEvent[] => [
  { type: "text", delta: text },
  { type: "usage", input, output: 0, cached: 0 },
  { type: "done", reason: "end" },
];
const call = (id: string, name: string, args: unknown): ModelEvent[] => [
  { type: "tool_call", id, name, args },
  { type: "usage", input: 10, output: 0, cached: 0 },
  { type: "done", reason: "tool_use" },
];

async function until(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 3000) throw new Error("Twin regression timed out");
    await Bun.sleep(5);
  }
}

async function fixture(
  options: {
    events?: Event[];
    holdFinal?: boolean;
    stage?: "checkpoint" | "question";
    budgets?: BudgetLimits;
  } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), "twin-recovery-"));
  const events: Event[] = [];
  const requests: ModelRequest[] = [];
  const reviewing = Promise.withResolvers<void>();
  let workerTurn = 0;
  let startRequested = false;
  let statusRequested = false;
  const provider: ModelProvider = {
    id: "test",
    model: "test",
    async *stream(request, signal) {
      requests.push(structuredClone(request));
      let script: ModelEvent[];
      if (request.system.includes("# Twin:")) {
        const input = request.messages[0]?.content ?? "";
        const final = input.includes('"phase":"final"');
        if (final && options.holdFinal) {
          reviewing.resolve();
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return;
        }
        const expensive =
          input.includes('"phase":"checkpoint"') || input.includes('"phase":"question"');
        script = finish(
          JSON.stringify({
            verdict: "pass",
            voice: "Keep one screen.",
            instructions: "Use one screen.",
            entryIds: [],
            emotion: "calm",
          }),
          expensive ? 100 : 10,
        );
      } else if (!request.tools.length) {
        script = finish(
          JSON.stringify({
            progress: "Saved",
            locations: "checkout.txt",
            instructions: "Continue",
            nextSteps: "Review",
            risks: "None",
          }),
          0,
        );
      } else if (request.tools.some((tool) => tool.name === "worker")) {
        const status = request.messages.some(
          (message) => message.role === "user" && message.content === "Inspect worker status",
        );
        if ((status && statusRequested) || (!status && startRequested)) {
          script = finish("Worker status reported.");
        } else {
          if (status) statusRequested = true;
          else startRequested = true;
          script = call(
            status ? "status" : "start",
            "worker",
            status ? { operation: "status" } : { operation: "start", task: "Build checkout." },
          );
        }
      } else if (options.stage === "checkpoint") {
        const stages = [
          call("begin", "context", { op: "begin", title: "Checkout", objective: "Build checkout" }),
          call("save", "write", { path: "checkout.txt", content: "One screen." }),
          call("complete", "context", {
            op: "complete",
            summary: "Checkout saved",
            evidence: ["checkout.txt saved"],
            next: "Review",
          }),
        ];
        script = stages[workerTurn++] ?? finish("<summary>Checkout finished.</summary>");
      } else if (options.stage === "question" && workerTurn++ === 0) {
        script = call("question", "ask", {
          question: "How many checkout screens?",
          options: ["One", "Two"],
        });
      } else {
        workerTurn++;
        script = finish("<summary>Checkout finished.</summary>");
      }
      for (const event of script) yield event;
    },
  };
  const twin = await projectTwin({
    cwd,
    home: cwd,
    secrets: () => [],
    target: () => ({
      provider,
      providerId: "test",
      model: "test",
      price: (usage) => usage.input / 1000,
    }),
  });
  await twin.configure({ enabled: true });
  const config = HarnessConfigSchema.parse({ useDefaults: false, provider: "test", model: "test" });
  const conversation = await createConversation(
    {
      cwd,
      sessionId: "recovery",
      provider,
      providerId: "test",
      model: "test",
      tools: new ToolRegistry(builtinTools(), { limits }),
      system: "test",
      limits,
      maxOutputTokens: 2000,
      context: { window: 64000, reserve: 2000 },
      loop: { maxTurns: 10, continuations: 0, parallelTools: false },
      price: (usage) => usage.input / 1000,
      ...(options.budgets ? { budgets: options.budgets } : {}),
      ...(options.stage === "checkpoint"
        ? { pages: () => pageSink(sessionPaths(cwd, "recovery_worker")) }
        : {}),
      logDir: () => join(cwd, "logs"),
      onEvent: (event) => {
        events.push(event);
      },
    },
    {
      events: options.events ?? [],
      twin,
      configure: (current, execute, answer) =>
        conversationOptions(current, config, [], execute, answer),
    },
  );
  cleanup.push(async () => {
    await conversation.dispose();
    await twin.dispose();
    await rm(cwd, { recursive: true, force: true });
  });
  async function status(): Promise<{ result?: RunResult; running: boolean }> {
    await conversation.send({
      type: "run",
      sessionId: "recovery",
      prompt: "Inspect worker status",
    });
    await conversation.flush();
    const event = events.findLast(
      (event) => event.type === "tool.finished" && event.call.id === "status",
    );
    if (event?.type !== "tool.finished") throw new Error("Missing Worker status");
    return event.result.data as { result?: RunResult; running: boolean };
  }
  return { conversation, events, requests, reviewing, status };
}

test("Reopening a finished Worker with interrupted Twin acceptance restores an unconfirmed result", async () => {
  const original = await fixture({ holdFinal: true });
  await original.conversation.send({
    type: "run",
    sessionId: "recovery",
    prompt: "Build checkout",
  });
  await original.reviewing.promise;
  await original.conversation.flush();
  const events = structuredClone(original.events);
  expect(
    events.some(
      (event) =>
        event.type === "worker.event" &&
        event.event.type === "session.finished" &&
        event.event.result.pass,
    ),
  ).toBe(true);
  await original.conversation.dispose();
  const restored = await fixture({ events });
  const status = await restored.status();
  expect(status.running).toBe(false);
  expect(status.result).toMatchObject({ pass: false, summary: "Checkout finished." });
});

test("A persisted final Twin acceptance restores the accepted result", async () => {
  const original = await fixture();
  await original.conversation.send({
    type: "run",
    sessionId: "recovery",
    prompt: "Build checkout",
  });
  await until(() =>
    original.events.some(
      (event) =>
        event.type === "twin.activity" &&
        event.activity.phase === "final" &&
        event.activity.state === "pass",
    ),
  );
  await original.conversation.flush();
  const events = structuredClone(original.events);
  await original.conversation.dispose();
  const restored = await fixture({ events });
  expect((await restored.status()).result?.pass).toBe(true);
});

test("A Worker result that exhausts the shared budget cannot bypass final Twin acceptance", async () => {
  const f = await fixture({ budgets: { maxTokens: 20 } });
  await f.conversation.send({ type: "run", sessionId: "recovery", prompt: "Build checkout" });
  await until(() =>
    f.events.some(
      (event) =>
        event.type === "twin.activity" &&
        event.activity.phase === "final" &&
        event.activity.state === "exhausted",
    ),
  );
  expect((await f.status()).result).toMatchObject({ pass: false, stopReason: "done" });
  expect(
    f.requests.filter(
      (request) =>
        request.system.includes("# Twin:") &&
        request.messages[0]?.content.includes('"phase":"final"'),
    ),
  ).toHaveLength(0);
});

test.each([
  ["question", { maxTokens: 100 }, 1],
  ["checkpoint", { maxTokens: 100 }, 3],
  ["question", { maxCostUsd: 0.1 }, 1],
  ["checkpoint", { maxCostUsd: 0.1 }, 3],
] as const)(
  "Shared %s review spending respects %j before the next Worker request",
  async (stage, budgets, expectedRequests) => {
    const f = await fixture({ stage, budgets });
    await f.conversation.send({ type: "run", sessionId: "recovery", prompt: "Build checkout" });
    await until(() =>
      f.events.some(
        (event) => event.type === "worker.event" && event.event.type === "session.finished",
      ),
    );
    await f.conversation.flush();
    const status = await f.status();
    expect(status.result).toMatchObject({ pass: false, stopReason: "budget" });
    const workerRequests = f.requests.filter(
      (request) =>
        request.tools.length &&
        !request.tools.some((tool) => tool.name === "worker") &&
        !request.system.includes("# Twin:"),
    );
    expect(workerRequests).toHaveLength(expectedRequests);
    expect(
      f.events.some(
        (event) =>
          event.type === "twin.activity" &&
          event.activity.phase === "final" &&
          event.activity.state === "pass",
      ),
    ).toBe(false);
  },
);
