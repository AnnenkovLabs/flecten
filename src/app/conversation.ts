import workerNotice from "../../prompts/worker-notice.md" with { type: "text" };
import { wrapUntrusted } from "../core/loop/tool-message";
import { createEventBus } from "../core/session/event-bus";
import { isPersistentEvent, SessionPersistence } from "../core/session/persistence";
import { createSession, type SessionHandle, type SessionOptions } from "../core/session/session";
import type { Command, Event, RunResult, SessionEvent } from "../core/types";
import { replayMessages } from "../store/events/replay";
import { restoredQueue } from "../store/queue";
import type { ToolContext } from "../tools/types";
import { ConversationTwin, type ConversationTwinPort } from "./conversation-twin";
import { WorkerReferences } from "./worker-references";
import type { WorkerRequest } from "./worker-tool";

interface ConversationOptions {
  events: readonly Event[];
  twin?: ConversationTwinPort;
  configure(
    options: SessionOptions,
    execute: (request: WorkerRequest, context: ToolContext) => Promise<unknown>,
    answer: (question: string, signal: AbortSignal) => Promise<string | undefined>,
  ): Promise<{ talker: SessionOptions; worker: SessionOptions }>;
}

/** Two independently cancellable loops behind the existing session interface. */
export async function createConversation(
  options: SessionOptions,
  setup: ConversationOptions,
): Promise<SessionHandle> {
  const parentId = options.sessionId ?? `s_${crypto.randomUUID()}`;
  options.sessionId = parentId;
  const workerId = `${parentId}_worker`;
  const bus = createEventBus();
  const references = new WorkerReferences();
  const notices = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let muted = false;
  let configuring = Promise.resolve();
  let workerRun: Promise<unknown> | undefined;
  let talkerRun: Promise<unknown> | undefined;
  let lastWake = Date.now();
  let lastResult: RunResult | undefined;
  let executing = false;
  let executionEpoch = 0;
  let workerIntent: () => string | undefined = () => undefined;
  let revokeWorkerIntent = () => {};
  let talker: SessionHandle;
  let worker: SessionHandle;
  const persistence = new SessionPersistence(
    { onEvent: (event) => options.onEvent?.(event) },
    report,
  );
  const persisted = () => persistence.flush();
  const twin = new ConversationTwin(setup.twin, options, emit);
  twin.restore(setup.events);
  function emit(event: Event): void {
    if (isPersistentEvent(event)) persistence.event(event);
    bus.emit(event);
  }
  const takeNotices = () => {
    const text = [...notices.values()].join("\n\n");
    notices.clear();
    return text ? [{ text: `${workerNotice.trim()}\n\n${text}`, kind: "notice" as const }] : [];
  };
  function schedule(): void {
    if (disposed || muted || timer || !notices.size) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        if (talker.isBusy() || disposed || muted || !notices.size) return;
        const notice = takeNotices()[0];
        if (!notice) return;
        lastWake = Date.now();
        talkerRun = talker.send({
          type: "run",
          sessionId: parentId,
          prompt: notice.text,
          internal: true,
        });
        void talkerRun.catch(report).finally(schedule);
      },
      Math.max(20, 15_000 - (Date.now() - lastWake)),
    );
    timer.unref?.();
  }
  function report(error: unknown): void {
    bus.emit({
      type: "error",
      sessionId: parentId,
      code: "conversation_failed",
      message: String(error),
    });
  }
  function note(event: SessionEvent): void {
    twin.note(event);
    if (muted || disposed) {
      if (event.type === "session.finished") lastResult = event.result;
      return;
    }
    if (event.type === "tool.started") {
      // ponytail: one latest progress notice; full calls and logs remain in the event stream.
      notices.set(
        "progress",
        `Worker tool: ${event.call.name}\nReference: [[${event.call.id}]]\nStatus: running`,
      );
    } else if (event.type === "tool.finished") {
      notices.set(
        "progress",
        `Worker tool: ${event.call.name}\nReference: [[${event.call.id}]]\nStatus: ${event.result.ok ? "succeeded" : "failed"}`,
      );
    } else if (event.type === "session.finished") {
      return; // Completion reaches Talker only after the Twin's acceptance gate.
    } else if (event.type === "error") {
      notices.set(
        "error",
        `Worker error:\n${wrapUntrusted(event.message.slice(0, 2_000), { source: "mcp", ref: workerId })}`,
      );
    }
    schedule();
  }
  function publish(result: RunResult, review = ""): void {
    lastResult = result;
    clearTimeout(timer);
    timer = undefined;
    lastWake = 0;
    notices.delete("progress");
    notices.set(
      "result",
      `Worker status: ${result.stopReason}\n${review}\n\n${wrapUntrusted(result.summary.slice(0, 8_000), { source: "mcp", ref: workerId })}`,
    );
    schedule();
  }
  async function answer(question: string, signal: AbortSignal): Promise<string | undefined> {
    if (signal.aborted) return;
    const decision = await twin.decide("question", { question }, signal);
    if (!decision || decision.verdict === "ask_user" || signal.aborted) return;
    return twin.directions(decision);
  }
  async function executeTask(task: string, epoch: number): Promise<void> {
    try {
      let revision = twin.revision;
      let prepared = await twin.decide("prepare");
      for (let retry = 0; revision !== twin.revision && retry < 3; retry++) {
        if (disposed || muted || epoch !== executionEpoch) return;
        revision = twin.revision;
        prepared = await twin.decide("prepare");
      }
      if (revision !== twin.revision)
        throw new Error("User direction changed during preparation; Worker has not started");
      if (disposed || muted || epoch !== executionEpoch) return;
      let prompt = prepared ? `${task}\n\n${twin.directions(prepared)}` : task;
      for (;;) {
        if (twin.exhausted()) throw new Error("Twin task budget exhausted before execution");
        const remaining = twin.remaining();
        if (remaining) worker.update({ budgets: remaining });
        const result = (await worker.send({
          type: "run",
          sessionId: workerId,
          prompt,
        })) as RunResult;
        twin.commitWorker();
        if (disposed || muted || epoch !== executionEpoch) return;
        if (result.stopReason !== "done" && result.stopReason !== "end") {
          publish(result, "Twin acceptance: unconfirmed because execution stopped.");
          return;
        }
        let revision = twin.revision;
        let decision = await twin.decide("final", { result: result.summary });
        for (let retry = 0; revision !== twin.revision && retry < 3; retry++) {
          if (disposed || muted || epoch !== executionEpoch) return;
          revision = twin.revision;
          decision = await twin.decide("final", { result: result.summary });
        }
        if (revision !== twin.revision)
          throw new Error("User directions changed during Twin acceptance; review is pending");
        if (disposed || muted || epoch !== executionEpoch) return;
        if (decision?.verdict === "revise" && twin.corrections < 4 && !twin.exhausted()) {
          twin.corrections++;
          prompt = twin.directions(decision);
          continue;
        }
        const unresolved = decision ? decision.verdict !== "pass" : await twin.enabled();
        if (unresolved && decision) twin.unresolved(decision);
        publish(
          unresolved ? { ...result, pass: false } : result,
          decision
            ? `Twin acceptance: ${unresolved ? "unresolved" : "accepted"}\n${decision.voice}\n${decision.instructions}`
            : `Twin acceptance: ${unresolved ? "unconfirmed" : "disabled"}.`,
        );
        return;
      }
    } catch (error) {
      if (!disposed && !muted && epoch === executionEpoch) {
        notices.set(
          "twin-error",
          `Twin could not confirm completion: ${String(error).slice(0, 2000)}. Inspect current work before presenting it as finished.`,
        );
        report(error);
        schedule();
      }
    } finally {
      if (epoch === executionEpoch) executing = false;
    }
  }
  async function control(request: WorkerRequest, context: ToolContext): Promise<unknown> {
    if (disposed) throw new Error("Conversation is closed");
    if (request.operation === "status")
      return { ...worker.peek(), running: executing || worker.isBusy(), result: lastResult };
    if (request.operation === "stop") {
      executionEpoch++;
      executing = false;
      twin.cancel();
      return worker.send({ type: "stop", mode: "force" });
    }
    if (request.operation === "steer") {
      if (!worker.isBusy()) throw new Error("Worker is idle; start a task explicitly");
      revokeWorkerIntent();
      return worker.send({ type: "queue.add", text: request.message, mode: "steer" });
    }
    if (executing || worker.isBusy()) throw new Error("Worker is already running; use steer");
    muted = false;
    lastResult = undefined;
    notices.clear();
    const source = context.permissionIntent;
    let valid = true;
    workerIntent = () => (valid ? source?.() : undefined);
    revokeWorkerIntent = () => {
      valid = false;
    };
    worker.update({ permissionIntent: workerIntent });
    twin.begin(request.task);
    executing = true;
    workerRun = executeTask(request.task, ++executionEpoch);
    return { workerId, state: "running" };
  }
  const initial = await setup.configure(options, control, answer);
  await options.modules?.shareSession?.(parentId, workerId);
  const childEvents = setup.events.flatMap((event, index) =>
    event.type === "worker.event" ? [{ seq: index + 1, event: event.event }] : [],
  );
  const restoredResult = childEvents.findLast(
    ({ event }) => event.type === "session.finished",
  )?.event;
  if (restoredResult?.type === "session.finished") {
    const workerEnd = setup.events.findLastIndex(
      (event) => event.type === "worker.event" && event.event.type === "session.finished",
    );
    const reviewed = setup.events
      .slice(workerEnd + 1)
      .some(
        (event) =>
          event.type === "twin.activity" &&
          event.activity.phase === "final" &&
          event.activity.state === "pass",
      );
    const preparation = setup.events
      .slice(0, workerEnd)
      .findLast((event) => event.type === "twin.activity" && event.activity.phase === "prepare");
    const usedTwin =
      preparation?.type === "twin.activity" && preparation.activity.state !== "disabled";
    lastResult =
      usedTwin && !reviewed ? { ...restoredResult.result, pass: false } : restoredResult.result;
    if (usedTwin && !reviewed)
      notices.set(
        "unconfirmed",
        "Twin acceptance was interrupted or unresolved. Recheck the current artifacts and resume the review before presenting completion.",
      );
  }
  const boundary = childEvents.findLast(
    ({ event }) =>
      event.type === "session.started" ||
      event.type === "session.finished" ||
      event.type === "run.interrupted",
  )?.event;
  if (boundary?.type === "run.interrupted" || boundary?.type === "session.started")
    notices.set(
      "interrupted",
      "Worker execution was interrupted. Inspect actual files and process state before resuming; previous completion is unconfirmed.",
    );
  const mapped = (event: Event): Event => ({
    type: "worker.event",
    sessionId: parentId,
    event: references.event(event),
  });
  const queue = await restoredQueue(options.cwd, workerId);
  const executionOptions = (role: SessionOptions): SessionOptions => ({
    ...role,
    permissionIntent: workerIntent,
    sessionId: workerId,
    ...(queue ? { queue } : {}),
    loadHistory: async () => replayMessages(childEvents).messages,
    onEvent: persisted,
    takeNotices: () => twin.checkpoint(),
    externalBudgetExhausted: () =>
      twin.exhausted() ? "The shared Worker and Twin task budget is exhausted." : undefined,
  });
  worker = createSession(executionOptions(initial.worker));
  // After the first load, subsequent runs keep the Worker's own in-memory history.
  talker = createSession({
    ...initial.talker,
    sessionId: parentId,
    takeNotices,
    onEvent: persisted,
  });
  worker.subscribe((event) => {
    const forwarded = mapped(event);
    emit(forwarded);
    if (forwarded.type === "worker.event") note(forwarded.event);
  });
  talker.subscribe((event) => {
    if (event.type === "session.started" && !event.internal) twin.applied(event.prompt);
    if (event.type === "steer.applied") twin.applied(event.text);
    emit(event);
    if (event.type === "session.finished") schedule();
  });
  return {
    getSessionId: () => parentId,
    getHistory: () => talker.getHistory(),
    // Pool limits/retention must count execution even when the Talker is idle.
    isBusy: () => executing || talker.isBusy() || worker.isBusy() || notices.size > 0,
    peek: () => ({
      ...talker.peek(),
      jobs: talker.peek().jobs + worker.peek().jobs + Number(worker.isBusy()),
      approvals: talker.peek().approvals + worker.peek().approvals,
    }),
    waitsFor: (id) => talker.waitsFor(id) || worker.waitsFor(id),
    subscribe: (listener) => bus.subscribe(listener),
    update(next) {
      Object.assign(options, next);
      configuring = configuring
        .then(async () => {
          const roles = await setup.configure(options, control, answer);
          talker.update({ ...roles.talker, onEvent: persisted });
          worker.update(executionOptions(roles.worker));
        })
        .catch(report);
    },
    async send(command: Command): Promise<unknown> {
      if (command.type === "stop") {
        executionEpoch++;
        executing = false;
        twin.cancel();
        if (command.target === "worker")
          return worker.send({ type: "stop", ...(command.mode ? { mode: command.mode } : {}) });
        muted = true;
        clearTimeout(timer);
        timer = undefined;
        notices.clear();
        return Promise.all([talker.send(command), worker.send(command)]);
      }
      if (command.type === "approval.respond" && worker.waitsFor(command.id))
        return worker.send(command);
      if (command.type === "approval.allowAll" || command.type === "approval.denyAll") {
        return Promise.all([
          talker.send({ ...command, ids: command.ids.filter((id) => !worker.waitsFor(id)) }),
          worker.send({ ...command, ids: command.ids.filter((id) => worker.waitsFor(id)) }),
        ]);
      }
      if (command.type === "tool.cancel") {
        const raw = references.raw(command.callId);
        if (raw) return worker.send({ ...command, callId: raw });
      }
      if (command.type === "subagent.stop") return worker.send(command);
      if (command.type === "jobs.stop") return worker.send(command);
      await configuring;
      if (command.type === "run") {
        muted = false;
        if (!command.internal) twin.submitted(command.prompt);
        if (talker.isBusy())
          return talker.send({
            type: "queue.add",
            text: command.prompt,
            mode: "steer",
            ...(command.attachments ? { attachments: command.attachments } : {}),
            ...(command.contexts ? { contexts: command.contexts } : {}),
          });
        talkerRun = talker.send(command);
        return talkerRun;
      }
      if (command.type === "queue.add" && command.mode === "steer") twin.submitted(command.text);
      return talker.send(command);
    },
    async flush() {
      await Promise.all([talker.flush(), worker.flush()]);
      await persistence.flush();
    },
    async dispose() {
      disposed = true;
      executionEpoch++;
      twin.cancel();
      clearTimeout(timer);
      await Promise.all([talker.send({ type: "stop" }), worker.send({ type: "stop" })]);
      await Promise.allSettled([talkerRun, workerRun, configuring]);
      await Promise.all([talker.dispose(), worker.dispose()]);
    },
  };
}
