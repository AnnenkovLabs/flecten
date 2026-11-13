import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers } from "../../src/app/server-handlers";
import type { AppService } from "../../src/app/service";
import { SessionPool } from "../../src/app/session-pool";
import { createSession } from "../../src/core/session/session";
import type { Event } from "../../src/core/types";
import { PermissionEngine } from "../../src/security/permissions";
import { builtinTools } from "../../src/tools/builtin";
import { ToolRegistry } from "../../src/tools/registry";
import type { AgentCommand, AgentEvent, AgentInfo } from "../../ui/src/lib/types";
import type * as Ui from "../fixtures/session-state-ui";
import { scriptedProvider } from "../helpers/fake-provider";
import "../helpers/svelte-runes";

const ui = (await import("../fixtures/session-state-ui")) as typeof Ui;
const originalWindow = globalThis.window;
afterEach(() => {
  globalThis.window = originalWindow;
  ui.toast.dispose();
});

const limits = {
  maxOutputBytes: 50000,
  maxOutputLines: 2000,
  bashTimeoutMs: 10000,
  readLimitLines: 2000,
};

test("real queue and approval commands keep UI state on failed IPC and converge after reconnect", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-state-ui-"));
  const stored: Event[] = [];
  const provider = scriptedProvider([
    [
      { type: "tool_call", id: "c1", name: "bash", args: { command: "echo never" } },
      { type: "done", reason: "tool_use" },
    ],
    [
      { type: "text", delta: "<summary>done</summary><complete/>" },
      { type: "done", reason: "end" },
    ],
  ]);
  const pool = new SessionPool({
    maxActive: () => 4,
    create: async (sessionId) =>
      createSession({
        cwd,
        provider,
        providerId: "scripted",
        model: "scripted",
        system: "test",
        limits,
        tools: new ToolRegistry(builtinTools(), { limits }),
        maxOutputTokens: 1000,
        context: { window: 100000, reserve: 1000 },
        loop: { maxTurns: 3, continuations: 0, parallelTools: false },
        logDir: () => join(cwd, "logs"),
        permissions: new PermissionEngine({
          rules: [{ action: "shell", tool: "bash", policy: "ask" }],
        }),
        onEvent: (event) => {
          stored.push(event);
        },
        ...(sessionId ? { sessionId } : {}),
      }),
  });
  const handlers = createHandlers({ session: pool } as AppService, () => undefined);
  const listeners = new Set<(event: AgentEvent) => void>();
  const fail = new Set<string>();
  globalThis.window = {
    desktop: {
      agent: {
        onEvent(listener: (event: AgentEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        send(command: AgentCommand) {
          if (!("requestId" in command)) throw new Error("expected request");
          const respond = (value: object) => {
            for (const listener of listeners)
              listener({ type: "response", requestId: command.requestId, ...value } as AgentEvent);
          };
          queueMicrotask(() => {
            if (fail.has(command.type)) {
              respond({ ok: false, error: "IPC failed before delivery" });
              return;
            }
            const handler = handlers[command.type as keyof typeof handlers];
            Promise.resolve(handler(command)).then(
              (reply) => respond({ ok: true, ...reply }),
              (error) => respond({ ok: false, error: String(error) }),
            );
          });
        },
      },
    },
  } as unknown as Window & typeof globalThis;
  const view = new ui.TaskView({ checkpointSaved() {} });
  const activity = new ui.TaskActivity();
  const commands = new ui.TaskCommands(view, () => "s-state");
  let connected = true;
  let requested!: () => void;
  const waiting = new Promise<void>((resolve) => {
    requested = resolve;
  });
  const unsubscribe = pool.subscribeStamped((event) => {
    if (event.type === "approval.requested") requested();
    if (!connected) return;
    activity.apply(event as AgentEvent);
    view.apply(event as Parameters<Ui.TaskView["apply"]>[0]);
  });
  let running: Promise<unknown> | undefined;
  try {
    running = pool.send({ type: "run", sessionId: "s-state", prompt: "ask first" });
    await waiting;
    await handlers["queue.add"]({
      type: "queue.add",
      sessionId: "s-state",
      id: "q1",
      text: "original",
    });
    const approval = view.thread.items.find((item) => item.kind === "approval");
    expect(approval?.kind).toBe("approval");
    if (approval?.kind !== "approval") throw new Error("approval missing");
    const revision = view.state?.revision;
    fail.add("queue.edit");
    fail.add("queue.remove");
    fail.add("approval.respond");
    await commands.editQueued("q1", "lost edit");
    await commands.removeQueued("q1");
    await commands.respondApproval("s-state", approval.approval.id, "allow_once");
    expect(view.queued.map((item) => item.text)).toEqual(["original"]);
    expect(approval.state).toBe("pending");
    expect(activity.of("s-state").approvals).toBe(1);
    expect(view.state?.revision).toBe(revision);
    fail.clear();
    await commands.editQueued("q1", "confirmed");
    expect(view.queued[0]?.text).toBe("confirmed");
    connected = false;
    view.coreLost();
    await pool.send({ type: "stop", sessionId: "s-state" });
    await running;
    await pool.send({
      type: "queue.edit",
      sessionId: "s-state",
      id: "q1",
      text: "changed while disconnected",
    });
    const response = await handlers.status({ type: "status", sessionId: "s-state" });
    const status = response?.state as AgentInfo;
    view.reset();
    view.restore(stored as AgentEvent[]);
    view.attach(status);
    activity.sync(pool.activity());
    const stateEvent = pool
      .replay("s-state")
      .events.findLast((event) => event.type === "session.state");
    if (stateEvent?.type !== "session.state") throw new Error("state missing");
    for (let index = 0; index < 3; index += 1) {
      view.apply(stateEvent);
      activity.apply(stateEvent);
    }
    expect(view.phase).toBe("stopped");
    expect(view.busy).toBe(false);
    expect(view.queued.map((item) => item.text)).toEqual(["changed while disconnected"]);
    expect(activity.of("s-state")).toMatchObject({ running: false, approvals: 0, jobs: 0 });
    expect(
      view.thread.items.filter((item) => item.kind === "approval" && item.state === "pending"),
    ).toHaveLength(0);
    const old = status.sessionState;
    if (!old) throw new Error("snapshot missing");
    await commands.removeQueued("q1");
    view.applyState(old);
    activity.applyState(old);
    expect(view.queued).toHaveLength(0);
    expect(activity.of("s-state").approvals).toBe(0);
    const restarted = { ...old, epoch: "new-core", revision: 1, phase: "idle" as const, queue: [] };
    view.applyState(restarted);
    activity.applyState(restarted);
    view.applyState(old);
    activity.applyState(old);
    expect(view.state?.epoch).toBe("new-core");
    expect(view.phase).toBe("idle");
    expect(view.queued).toHaveLength(0);
  } finally {
    unsubscribe();
    await pool.dispose();
    await running;
    await rm(cwd, { recursive: true, force: true });
  }
});

test("preparation and its failure publish the same phase used by status and the view", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liquid-preparing-ui-"));
  let failPreparation!: (error: Error) => void;
  const history = new Promise<never>((_resolve, reject) => {
    failPreparation = reject;
  });
  const session = createSession({
    cwd,
    sessionId: "s-prepare",
    provider: scriptedProvider([]),
    providerId: "scripted",
    model: "m",
    system: "test",
    limits,
    tools: new ToolRegistry([], { limits }),
    maxOutputTokens: 1000,
    context: { window: 100000, reserve: 1000 },
    loop: { maxTurns: 1, continuations: 0, parallelTools: false },
    logDir: () => join(cwd, "logs"),
    loadHistory: () => history,
  });
  const view = new ui.TaskView({ checkpointSaved() {} });
  const stop = session.subscribe((event) => {
    if (event.type === "session.state") view.apply(event);
  });
  try {
    const running = session.send({ type: "run", sessionId: "s-prepare", prompt: "start" });
    const status = (await session.send({ type: "status" })) as AgentInfo;
    view.attach(status);
    expect(view.phase).toBe("running");
    expect(view.busy).toBe(true);
    failPreparation(new Error("history unavailable"));
    await expect(running).rejects.toThrow("history unavailable");
    expect(view.phase).toBe("failed");
    expect(view.busy).toBe(false);
  } finally {
    stop();
    await session.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
