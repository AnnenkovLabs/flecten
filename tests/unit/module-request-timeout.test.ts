import { beforeAll, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { MODULE_FRAME_BRIDGE } from "../../ui/src/lib/modules/frame-bridge";

let desktopCode = "";
beforeAll(async () => {
  const result = await Bun.build({
    entrypoints: ["ui/src/lib/desktop.ts"],
    target: "node",
    format: "cjs",
    plugins: [
      {
        name: "plain-i18n",
        setup(build) {
          build.onLoad({ filter: /\/i18n\.svelte\.ts$/ }, () => ({
            contents: "export const t = key => key;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const output = result.outputs[0];
  if (!result.success || !output) throw new Error("Could not bundle desktop transport");
  desktopCode = await output.text();
});

function clock() {
  let now = 0,
    sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    performance: { now: () => now },
    Date: { now: () => now },
    setTimeout(callback: () => void, delay: number) {
      const id = ++sequence;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    tick(ms: number) {
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
  };
}
function transport() {
  const time = clock();
  const listeners = new Set<(event: unknown) => void>();
  const sent: Record<string, unknown>[] = [];
  const module = {
    exports: {} as { requestAgent: (command: unknown, timeout: number) => Promise<unknown> },
  };
  const agent = {
    send(command: Record<string, unknown>) {
      sent.push(command);
    },
    onEvent(listener: (event: unknown) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  runInNewContext(desktopCode, {
    module,
    exports: module.exports,
    window: { desktop: { agent } },
    crypto,
    ...time,
  });
  const command = {
    type: "modules.invoke",
    sessionId: "chat",
    name: "computer-use",
    surface: "computer",
    revision: "hash",
    request: {
      type: "flecten.module.request",
      id: "rpc-1",
      method: "call",
      tool: "desktop_start",
      arguments: {},
    },
  };
  const pending = module.exports.requestAgent(command, 100);
  let outcome = "pending";
  pending.then(
    () => {
      outcome = "resolved";
    },
    () => {
      outcome = "rejected";
    },
  );
  const emit = (event: unknown) => {
    for (const listener of listeners) listener(event);
  };
  const ask = (callId = "module-ui-rpc-1", expiresAt = 500) =>
    emit({
      type: "approval.requested",
      sessionId: "chat",
      approval: { id: "approval-1", callId, expiresAt },
    });
  return { time, pending, emit, ask, sent, outcome: () => outcome, listeners };
}

test("surface transport pauses only its exact approval wait and resumes after the typed receipt", async () => {
  const f = transport();
  f.time.tick(20);
  f.ask();
  f.time.tick(200);
  await Promise.resolve();
  expect(f.outcome()).toBe("pending");
  f.emit({
    type: "approval.resolved",
    sessionId: "chat",
    id: "approval-1",
    choice: "deny",
    by: "timeout",
  });
  f.time.tick(79);
  f.emit({
    type: "response",
    requestId: f.sent[0]?.requestId,
    ok: true,
    moduleResult: { ok: false, data: { kind: "permission", outcome: "timeout" } },
  });
  expect(await f.pending).toMatchObject({
    moduleResult: { data: { kind: "permission", outcome: "timeout" } },
  });
  expect(f.listeners.size).toBe(0);
});

test("an unrelated approval does not suspend a lost surface response timeout", async () => {
  const f = transport();
  f.ask("another-request");
  f.time.tick(100);
  await expect(f.pending).rejects.toThrow("request timed out");
});

test("an expired approval without a receipt cannot leave the transport suspended forever", async () => {
  const f = transport();
  f.time.tick(20);
  f.ask("module-ui-rpc-1", 200);
  f.time.tick(260);
  await expect(f.pending).rejects.toThrow("request timed out");
});

test("sidecar exit rejects a surface request immediately even during its approval wait", async () => {
  const f = transport();
  f.ask();
  f.emit({ type: "agent.exit", code: 1, message: "sidecar closed" });
  f.time.tick(100);
  await expect(f.pending).rejects.toThrow("sidecar closed");
  expect(f.listeners.size).toBe(0);
});

test("the frame transfers its timeout to the accepting host instead of racing human approval", async () => {
  const time = clock();
  const handlers = new Map<string, (event: unknown) => void>();
  const messages: Record<string, unknown>[] = [];
  const parent = {
    postMessage(message: Record<string, unknown>) {
      messages.push(message);
    },
  };
  const window = {} as { flecten: { call: (tool: string) => Promise<unknown> } };
  runInNewContext(MODULE_FRAME_BRIDGE, {
    window,
    parent,
    crypto,
    document: {},
    Object,
    Error,
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      handlers.set(name, callback),
    ...time,
  });
  const pending = window.flecten.call("desktop_start");
  let settled = false;
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  handlers.get("message")?.({
    source: parent,
    data: { type: "flecten.module.accepted", id: messages[0]?.id },
  });
  time.tick(24 * 60 * 60 * 1000);
  await Promise.resolve();
  expect(settled).toBe(false);
  handlers.get("message")?.({
    source: parent,
    data: {
      type: "flecten.module.response",
      id: messages[0]?.id,
      ok: true,
      result: { ok: false, data: { kind: "permission", outcome: "timeout" } },
    },
  });
  expect(await pending).toMatchObject({ data: { kind: "permission", outcome: "timeout" } });
  const lost = window.flecten.call("unaccepted").catch((error: Error) => error.message);
  time.tick(300_000);
  expect(await lost).toBe("Module request timed out");
  const closed = window.flecten.call("pending").catch((error: Error) => error.message);
  handlers.get("pagehide")?.({});
  expect(await closed).toBe("Module surface closed");
});
