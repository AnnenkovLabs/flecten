import { afterEach, expect, test } from "bun:test";
import type { ModelChoice } from "../../shared/model-choice";
import { RunStore } from "../../ui/src/lib/run.svelte";
import type { AgentCommand, AgentEvent, AgentInfo } from "../../ui/src/lib/types";

type ModelCommand = Extract<AgentCommand, { type: "model.set" }>;
type Response = Extract<AgentEvent, { type: "response" }>;
const defaults: AgentInfo = {
  cwd: "/project",
  project: "Project",
  branch: "main",
  user: "User",
  provider: "relay",
  model: "default",
  contextWindow: 128000,
  maxOutputTokens: 4096,
  providers: [
    {
      id: "relay",
      name: "Relay",
      protocol: "openai-chat",
      baseUrl: "http://localhost",
      apiKeySet: true,
      active: true,
      models: {
        default: { context: 128000, output: 4096 },
        first: { context: 64000, reasoningLevels: ["low", "high"], variants: { fast: {} } },
        second: { context: 32000 },
        toggle: { reasoningMode: "toggle" },
      },
    },
  ],
};
const originalWindow = globalThis.window;
afterEach(async () => {
  await Bun.sleep(1);
  globalThis.window = originalWindow;
});

function harness() {
  const listeners = new Set<(event: AgentEvent) => void>();
  const calls: AgentCommand[] = [];
  const saved = new Map<string, ModelChoice>();
  const events = new Map<string, AgentEvent[]>();
  const pending: ModelCommand[] = [];
  const statusReplies: Array<() => void> = [];
  let delayed = false;
  let delayStatus = false;
  let includeScopedInfo = true;
  const emit = (event: AgentEvent) => {
    for (const listener of listeners) listener(event);
  };
  const reply = (command: { requestId: string }, fields: Partial<Response> = {}) =>
    emit({ type: "response", requestId: command.requestId, ok: true, ...fields });
  const scoped = (id: string): AgentInfo => {
    const choice = saved.get(id);
    return {
      ...defaults,
      sessionId: id,
      ...(choice ? { provider: choice.provider, model: choice.model } : {}),
      ...(choice?.reasoning ? { reasoning: choice.reasoning } : {}),
      ...(choice?.variant ? { variant: choice.variant } : {}),
    };
  };
  const finish = (command: ModelCommand, error?: string) => {
    if (error) return reply(command, { ok: false, error });
    const choice = {
      provider: command.provider,
      model: command.model,
      reasoning: command.reasoning,
      variant: command.variant,
    };
    if (command.sessionId) saved.set(command.sessionId, choice);
    const info: AgentInfo = { ...defaults, provider: choice.provider, model: choice.model };
    if (command.sessionId) info.sessionId = command.sessionId;
    if (choice.reasoning) info.reasoning = choice.reasoning;
    if (choice.variant) info.variant = choice.variant;
    reply(command, { info });
  };
  const target = Object.assign(new EventTarget(), {
    desktop: {
      agent: {
        onEvent(listener: (event: AgentEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(command: AgentCommand) {
          calls.push(command);
          queueMicrotask(() => {
            if (command.type === "model.set") {
              if (delayed) pending.push(command);
              else finish(command);
            } else if (command.type === "sessions.get")
              reply(command, { events: events.get(command.id) ?? [] });
            else if (command.type === "status" && "sessionId" in command) {
              const snapshot = {
                ...(includeScopedInfo ? { info: scoped(command.sessionId) } : {}),
                state: scoped(command.sessionId),
              };
              const respond = () => reply(command, snapshot);
              if (delayStatus) statusReplies.push(respond);
              else respond();
            } else if (command.type === "events.replay") reply(command);
            else if ("requestId" in command) reply(command);
          });
        },
      },
    },
  });
  globalThis.window = target as unknown as Window & typeof globalThis;
  const store = new RunStore();
  store.handle({ type: "status", ...defaults });
  return {
    store,
    calls,
    saved,
    events,
    pending,
    finish,
    delay() {
      delayed = true;
    },
    legacy() {
      includeScopedInfo = false;
    },
    statusReplies,
    delayStatus() {
      delayStatus = true;
    },
  };
}

const flush = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve();
};

test("global catalog status preserves the current chat choice and the next chat uses defaults", async () => {
  const { store, calls } = harness();
  await store.setModel("relay", "first");
  const id = store.activeTask;
  store.handle({ type: "status", ...defaults });
  expect(store.model).toBe("first");
  expect(store.contextView.window).toBe(64000);
  expect(calls.find((command) => command.type === "model.set")).toMatchObject({ sessionId: id });
  store.newTask();
  expect(store.model).toBe("default");
});

test("model, reasoning and variant survive chat navigation and restored durable choices", async () => {
  const { store } = harness();
  await store.setModel("relay", "first");
  store.setReasoning("high");
  await store.modelChange;
  await store.setVariant("fast");
  const first = store.activeTask;
  store.newTask();
  await store.setModel("relay", "second");
  store.setReasoning("low");
  await store.modelChange;
  const second = store.activeTask;
  await store.selectTask(first);
  expect([store.model, store.reasoning, store.variant]).toEqual(["first", "high", "fast"]);
  await store.selectTask(second);
  expect([store.model, store.reasoning, store.variant]).toEqual(["second", "low", undefined]);
});

test("a delayed answer only updates the chat that initiated it", async () => {
  const h = harness();
  h.delay();
  const changing = h.store.setModel("relay", "first");
  const first = h.store.activeTask;
  await flush();
  h.store.newTask();
  expect(h.store.model).toBe("default");
  h.finish(h.pending.shift() as ModelCommand);
  await changing;
  expect(h.store.model).toBe("default");
  await h.store.selectTask(first);
  expect(h.store.model).toBe("first");
});

test("rapid choices serialize per chat and sending waits for the last choice", async () => {
  const h = harness();
  h.delay();
  const first = h.store.setModel("relay", "first");
  const last = h.store.setModel("relay", "second");
  expect(h.store.model).toBe("second");
  expect(h.store.start("Use the last model")).toBe(true);
  await flush();
  expect(h.pending).toHaveLength(1);
  expect(h.calls.some((command) => command.type === "run")).toBe(false);
  h.finish(h.pending.shift() as ModelCommand);
  await first;
  await flush();
  expect(h.store.model).toBe("second");
  expect(h.pending).toHaveLength(1);
  expect(h.calls.some((command) => command.type === "run")).toBe(false);
  h.finish(h.pending.shift() as ModelCommand);
  await last;
  await flush();
  expect(h.saved.get(h.store.activeTask)?.model).toBe("second");
  expect(h.calls.filter((command) => command.type === "run")).toHaveLength(1);
});

test("a scoped model event updates its own chat and unsupported reasoning resets", async () => {
  const h = harness();
  await h.store.setModel("relay", "first");
  h.store.setReasoning("high");
  await h.store.modelChange;
  await h.store.setModel("relay", "toggle");
  expect(h.store.reasoning).toBe("auto");
  h.store.handle({
    type: "model.selected",
    sessionId: "another-chat",
    provider: "relay",
    model: "second",
  });
  expect(h.store.model).toBe("toggle");
});

test("reopening restores a durable choice and old chats fall back to their main run", async () => {
  const h = harness();
  h.legacy();
  h.events.set("selected", [
    { type: "session.started", sessionId: "selected", provider: "relay", model: "default" },
    {
      type: "model.selected",
      sessionId: "selected",
      provider: "relay",
      model: "first",
      reasoning: "high",
      variant: "fast",
    },
  ]);
  h.events.set("old-chat", [
    {
      type: "session.started",
      sessionId: "old-chat",
      provider: "relay",
      model: "second",
      reasoning: "low",
    },
    {
      type: "session.started",
      sessionId: "old-chat",
      provider: "relay",
      model: "toggle",
      internal: true,
    },
    {
      type: "session.started",
      sessionId: "old-chat",
      provider: "relay",
      model: "toggle",
      role: "worker",
    },
  ]);
  await h.store.selectTask("selected");
  expect([h.store.model, h.store.reasoning, h.store.variant]).toEqual(["first", "high", "fast"]);
  await h.store.selectTask("old-chat");
  expect([h.store.model, h.store.reasoning, h.store.variant]).toEqual(["second", "low", undefined]);
});

test("failed rapid choices roll back to the last confirmed model", async () => {
  const h = harness();
  h.delay();
  const first = h.store.setModel("relay", "first");
  const last = h.store.setModel("relay", "second");
  await flush();
  h.finish(h.pending.shift() as ModelCommand, "first failed");
  await first;
  await flush();
  h.finish(h.pending.shift() as ModelCommand, "second failed");
  await last;
  expect(h.store.model).toBe("default");
});

test("a send waiting for model selection cannot cross a project change", async () => {
  const h = harness();
  h.delay();
  const changing = h.store.setModel("relay", "first");
  h.store.start("Old project prompt");
  await flush();
  h.store.handle({ type: "project.changed", cwd: "/other-project" });
  h.finish(h.pending.shift() as ModelCommand);
  await changing;
  await flush();
  expect(h.calls.some((command) => command.type === "run")).toBe(false);
});

test("a model event received while opening wins over an older status snapshot", async () => {
  const h = harness();
  h.delayStatus();
  const opening = h.store.selectTask("existing");
  await flush();
  h.store.handle({
    type: "model.selected",
    sessionId: "existing",
    provider: "relay",
    model: "first",
  });
  for (const reply of h.statusReplies) reply();
  await opening;
  expect(h.store.model).toBe("first");
});
