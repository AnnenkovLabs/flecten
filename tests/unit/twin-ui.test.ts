import { afterEach, expect, test } from "bun:test";
import type { TwinSnapshot } from "../../shared/twin";
import { TwinStore } from "../../ui/src/lib/twin.svelte";
import type { AgentCommand, AgentEvent } from "../../ui/src/lib/types";

type Request = Extract<AgentCommand, { requestId: string }>;
type Response = Omit<Extract<AgentEvent, { type: "response" }>, "requestId" | "type">;
const originalWindow = globalThis.window;
const stores: TwinStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  globalThis.window = originalWindow;
});

function bridge() {
  const listeners = new Set<(event: AgentEvent) => void>();
  const requests: Request[] = [];
  globalThis.window = {
    desktop: {
      agent: {
        onEvent(listener: (event: AgentEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(command: AgentCommand) {
          if (!("requestId" in command)) throw new Error("Expected request");
          requests.push(command);
        },
      },
    },
  } as unknown as Window & typeof globalThis;
  const store = new TwinStore();
  stores.push(store);
  return {
    store,
    requests,
    reply(command: Request | undefined, result: Response) {
      if (!command) throw new Error("Missing request");
      for (const listener of listeners)
        listener({ type: "response", requestId: command.requestId, ...result });
    },
  };
}

function snapshot(state: TwinSnapshot["training"]["state"] = "idle"): TwinSnapshot {
  return {
    enabled: true,
    sources: [
      {
        id: "liquid",
        name: "Liquid Harness",
        path: "/project/.liquid/sessions",
        available: true,
        sessions: 1,
        selected: false,
        status: "ready",
        warnings: [],
      },
    ],
    entries: [],
    candidates: [],
    training: {
      state,
      message: "",
      sessions: 1,
      messages: 1,
      usage: { input: 0, output: 0, cached: 0 },
      provider: "test",
      model: "test-model",
    },
    limits: {
      maxSessions: 10,
      maxMessages: 100,
      maxInputCharacters: 1000,
      maxCandidates: 10,
      maxProfileEntries: 10,
    },
  };
}

test("late training polls cannot undo cancellation or resurrect the learning screen", async () => {
  const h = bridge();
  const loading = h.store.load();
  h.reply(h.requests[0], { ok: true, twin: snapshot("learning") });
  await loading;
  await Bun.sleep(1050);
  const poll = h.requests[1];
  expect(poll?.type).toBe("twin.get");
  const cancelling = h.store.cancel();
  h.reply(h.requests[2], { ok: true, twin: snapshot("cancelled") });
  await cancelling;
  h.reply(poll, { ok: true, twin: snapshot("learning") });
  await Bun.sleep(0);
  expect(h.store.snapshot?.training.state).toBe("cancelled");
  expect(h.store.training).toBe(false);
});

test("late failed polls cannot replace a newer successful action with an error", async () => {
  const h = bridge();
  const loading = h.store.load();
  h.reply(h.requests[0], { ok: true, twin: snapshot("learning") });
  await loading;
  await Bun.sleep(1050);
  const poll = h.requests[1];
  const configuring = h.store.configure(false);
  h.reply(h.requests[2], { ok: true, twin: { ...snapshot("ready"), enabled: false } });
  await configuring;
  h.reply(poll, { ok: false, error: "Old poll failed" });
  await Bun.sleep(0);
  expect(h.store.error).toBe("");
  expect(h.store.snapshot?.enabled).toBe(false);
});

test("a recovered training poll clears its connection error and retains valid state after malformed data", async () => {
  const h = bridge();
  const loading = h.store.load();
  h.reply(h.requests[0], { ok: true, twin: snapshot("learning") });
  await loading;
  await Bun.sleep(1050);
  h.reply(h.requests[1], { ok: false, error: "The core disconnected" });
  await Bun.sleep(0);
  expect(h.store.error).toBe("The core disconnected");
  expect(h.store.training).toBe(true);
  await Bun.sleep(1050);
  h.reply(h.requests[2], { ok: true, twin: snapshot("ready") });
  await Bun.sleep(0);
  expect(h.store.error).toBe("");
  expect(h.store.training).toBe(false);
  const refreshing = h.store.load();
  h.reply(h.requests[3], { ok: true, twin: { ...snapshot(), training: {} } as TwinSnapshot });
  await refreshing;
  expect(h.store.error.length).toBeGreaterThan(0);
  expect(h.store.snapshot?.training.state).toBe("ready");
});

test("reopening Twin and rescanning preserve the user's source selection", async () => {
  const h = bridge();
  const loading = h.store.load();
  h.reply(h.requests[0], { ok: true, twin: snapshot() });
  await loading;
  h.store.toggleSource("liquid", true);
  for (const scan of [false, true]) {
    const refresh = h.store.load(scan);
    h.reply(h.requests.at(-1), { ok: true, twin: snapshot() });
    await refresh;
    expect(h.store.selected).toEqual(["liquid"]);
  }
});

test("Twin does not send empty training or repeated cancellation requests", async () => {
  const h = bridge();
  await h.store.train();
  expect(h.requests).toHaveLength(0);
  h.store.snapshot = snapshot("learning");
  const cancelling = h.store.cancel();
  const duplicate = h.store.cancel();
  expect(h.requests).toHaveLength(1);
  h.reply(h.requests[0], { ok: true, twin: snapshot("cancelled") });
  await Promise.all([cancelling, duplicate]);
  expect(h.store.busy).toBe(false);
});

test("changing project clears the selected section and ignores responses from the old project", async () => {
  const h = bridge();
  h.store.tab = "ask";
  h.store.question = "Checkout decision";
  const loading = h.store.load();
  h.store.reset();
  h.reply(h.requests[0], { ok: true, twin: snapshot("learning") });
  await loading;
  expect(h.store.snapshot).toBeNull();
  expect(h.store.busy).toBe(false);
  expect(h.store.question).toBe("");
  expect(String(h.store.tab)).toBe("sources");
  expect(h.store.projectEpoch).toBe(1);
});
