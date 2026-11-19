import workerNotice from "../../prompts/worker-notice.md" with { type: "text" };
import { wrapUntrusted } from "../core/loop/tool-message";
import { createEventBus } from "../core/session/event-bus";
import { isPersistentEvent, SessionPersistence } from "../core/session/persistence";
import { accountingChanged } from "../core/session/run-accounting";
import { createSession, type SessionHandle, type SessionOptions } from "../core/session/session";
import type { Command, Event, RunResult, SessionEvent } from "../core/types";
import { replayMessages } from "../store/events/replay";
import { restoredQueue } from "../store/queue";
import type { ToolContext } from "../tools/types";
import { ConversationAcceptance } from "./conversation-acceptance";
import { conversationBudget } from "./conversation-budget";
import type { ConversationOptions } from "./conversation-options";
import { restoreWorkerResult } from "./conversation-restore";
import { ConversationTwin } from "./conversation-twin";
import { answerWorkerQuestion } from "./talker-question";
import { WorkerRecovery } from "./worker-recovery";
import { WorkerReferences } from "./worker-references";
import type { WorkerRequest } from "./worker-tool";

/** Two independently cancellable loops behind the existing session interface. */
export async function createConversation(
  options: SessionOptions,
  setup: ConversationOptions,
): Promise<SessionHandle> {
  const parentId = options.sessionId ?? `s_${crypto.randomUUID()}`;
  options.sessionId = parentId;
  const workerId = `${parentId}_worker`;
  const bus = createEventBus();
  const ledger = conversationBudget(options, setup.events);
  options.taskBudget = ledger;
  const recovery = new WorkerRecovery();
  for (const event of setup.events) {
    if (event.type === "worker.event") recovery.note(event.event);
    else if (event.type === "worker.acceptance") recovery.note(event);
  }
  recovery.interrupted();
  const references = new WorkerReferences();
  const notices = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let muted = false;
  let configuring = Promise.resolve();
  let workerRun: Promise<unknown> | undefined;
  let talkerRun: Promise<unknown> | undefined;
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
  const acceptance = new ConversationAcceptance((state) =>
    emit({ type: "worker.acceptance", sessionId: parentId, acceptance: state }),
  );
  acceptance.restore(setup.events);
  function emit(event: Event): void {
    if (event.type === "worker.acceptance") recovery.note(event);
    if (isPersistentEvent(event)) persistence.event(event);
    bus.emit(event);
    if (
      (event.type !== "task.budget" && accountingChanged(event)) ||
      (event.type === "twin.activity" && event.activity.usage !== undefined)
    ) {
      const snapshot = { type: "task.budget" as const, sessionId: parentId, budget: ledger.view() };
      persistence.event(snapshot);
      bus.emit(snapshot);
    }
  }
  const takeNotices = () => {
    const text = [...notices.values()].join("\n\n");
    notices.clear();
    return text ? [{ text: `${workerNotice.trim()}\n\n${text}`, kind: "notice" as const }] : [];
  };
  function schedule(): void {
    if (
      disposed ||
      muted ||
      timer ||
      !notices.has("result") ||
      !lastResult ||
      !["done", "end"].includes(lastResult.stopReason)
    )
      return;
    timer = setTimeout(() => {
      timer = undefined;
      if (talker.isBusy() || disposed || muted || !notices.size) return;
      const notice = takeNotices()[0];
      if (!notice) return;
      talkerRun = talker.send({
        type: "run",
        sessionId: parentId,
        prompt: notice.text,
        internal: true,
      });
      void talkerRun.catch(report).finally(schedule);
    }, 0);
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
    // Tool cards already project these events. Narrating them would start another paid request.
    if (event.type === "error") {
      notices.set(
        "error",
        `Worker error:\n${wrapUntrusted(event.message.slice(0, 2_000), { source: "mcp", ref: workerId })}`,
      );
    }
  }
  function publish(result: RunResult, review = ""): void {
    if (acceptance.unmet()) result = { ...result, pass: false };
    acceptance.phase(
      result.pass && ["done", "end"].includes(result.stopReason)
        ? "accepted"
        : result.stopReason === "stopped"
          ? "stopped"
          : result.stopReason === "error"
            ? "error"
            : "unconfirmed",
    );
    lastResult = result;
    clearTimeout(timer);
    timer = undefined;
    notices.delete("progress");
    notices.set(
      "result",
      `Worker status: ${result.stopReason}\n${review}\n\n${acceptance.markdown()}\n\n${wrapUntrusted([recovery.partial, result.summary.slice(0, 8_000)].filter(Boolean).join("\n\n"), { source: "mcp", ref: workerId })}`,
    );
    if (result.stopReason === "done" || result.stopReason === "end") schedule();
    else {
      // Failure is already known locally, including quota failure. Do not call the same provider to explain it.
      emit({ type: "message.started", sessionId: parentId });
      emit({
        type: "message.finished",
        sessionId: parentId,
        text: recovery.partial
          ? `${recovery.partial}\n\nPartial result. Execution stopped: ${result.stopReason}.\n${result.summary}`
          : result.summary,
        reasoning: "",
        toolCalls: [],
        complete: false,
      });
    }
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
        const result = (await worker.send({
          type: "run",
          sessionId: workerId,
          prompt,
        })) as RunResult;
        twin.commitWorker();
        if (disposed || muted || epoch !== executionEpoch) return;
        acceptance.reviewing(result);
        if (result.stopReason !== "done" && result.stopReason !== "end") {
          publish(result, "Twin acceptance: unconfirmed because execution stopped.");
          return;
        }
        let revision = twin.revision;
        let decision = await twin.decide("final", {
          result: `${result.summary}\n\n${acceptance.markdown()}`,
        });
        for (let retry = 0; revision !== twin.revision && retry < 3; retry++) {
          if (disposed || muted || epoch !== executionEpoch) return;
          revision = twin.revision;
          decision = await twin.decide("final", {
            result: `${result.summary}\n\n${acceptance.markdown()}`,
          });
        }
        if (revision !== twin.revision)
          throw new Error("User directions changed during Twin acceptance; review is pending");
        if (disposed || muted || epoch !== executionEpoch) return;
        if (decision?.verdict === "revise" && twin.corrections < 4 && !twin.exhausted()) {
          twin.corrections++;
          prompt = twin.directions(decision);
          acceptance.reopen(prompt);
          continue;
        }
        const unresolved = decision ? decision.verdict !== "pass" : await twin.enabled();
        if (unresolved && decision) twin.unresolved(decision);
        const passed =
          !unresolved && !acceptance.unmet() && ["done", "end"].includes(result.stopReason);
        publish(
          { ...result, pass: passed },
          decision
            ? `Twin acceptance: ${unresolved ? "unresolved" : "accepted"}\n${decision.voice}\n${decision.instructions}`
            : `Twin acceptance: ${unresolved ? "unconfirmed" : "disabled"}.`,
        );
        return;
      }
    } catch (error) {
      if (!disposed && !muted && epoch === executionEpoch) {
        acceptance.phase("error");
        notices.set(
          "twin-error",
          `Twin could not confirm completion: ${String(error).slice(0, 2000)}. Inspect current work before presenting it as finished.`,
        );
        report(error);
      }
    } finally {
      if (epoch === executionEpoch) executing = false;
    }
  }
  function workerStatus() {
    return {
      ...worker.peek(),
      running: executing || worker.isBusy(),
      result: lastResult,
      acceptance: acceptance.state,
      recovery: recovery.view(),
      taskBudget: ledger.view(),
    };
  }
  async function control(request: WorkerRequest, context: ToolContext): Promise<unknown> {
    if (disposed) throw new Error("Conversation is closed");
    if (request.operation === "talker.question") {
      if (context.sessionId !== workerId)
        throw new Error("Only the execution Worker may ask Talker");
      return answerWorkerQuestion({
        sessionId: parentId,
        workerId,
        ...(request.question ? { question: request.question } : {}),
        ...(request.peek !== undefined ? { peek: request.peek } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
        history: talker.getHistory(),
        options: questionOptions,
        budget: ledger,
        context,
        emit,
      });
    }
    if (request.operation === "criterion.list" || request.operation === "criterion.report") {
      if (context.sessionId !== workerId)
        throw new Error("Only the execution Worker may report acceptance evidence");
      if (request.operation === "criterion.list")
        return acceptance.state ?? { state: "no_assignment" };
      return acceptance.report(request.report);
    }
    if (request.operation === "status") return workerStatus();
    if (request.operation === "stop") {
      executionEpoch++;
      executing = false;
      twin.cancel();
      acceptance.phase("stopped");
      return worker.send({ type: "stop", mode: "force" });
    }
    if (request.operation === "steer") {
      if (!executing && !worker.isBusy())
        throw new Error("Worker is idle; start a task explicitly");
      revokeWorkerIntent();
      acceptance.reopen(request.message);
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
    const task =
      request.operation === "resume"
        ? `${acceptance.resume()}\n\n${recovery.markdown()}`
        : acceptance.begin(request.task, request.assignment);
    twin.begin(task);
    executing = true;
    workerRun = executeTask(task, ++executionEpoch);
    return { workerId, state: "running", acceptance: acceptance.state };
  }
  const initial = await setup.configure(options, control, answer);
  let questionOptions = initial.talker;
  await options.modules?.shareSession?.(parentId, workerId);
  const childEvents = setup.events.flatMap((event, index) =>
    event.type === "worker.event" ? [{ seq: index + 1, event: event.event }] : [],
  );
  lastResult = restoreWorkerResult(
    setup.events,
    childEvents,
    notices,
    !acceptance.state || acceptance.state.phase === "accepted",
  );
  const mapped = (event: Event): Event => ({
    type: "worker.event",
    sessionId: parentId,
    event: references.event(event),
  });
  const queue = await restoredQueue(options.cwd, workerId);
  const executionOptions = (role: SessionOptions): SessionOptions => ({
    ...role,
    taskBudget: ledger,
    completionGuard: () =>
      acceptance.state && !acceptance.state.legacy && acceptance.unmet()
        ? acceptance.markdown()
        : undefined,
    permissionIntent: workerIntent,
    approvalSessionId: parentId,
    sessionId: workerId,
    ...(role.pages
      ? {
          pages: (id: string) =>
            role.pages?.(id, parentId) as import("../core/pages/writer").PageSink,
        }
      : {}),
    ...(queue ? { queue } : {}),
    loadHistory: async () => replayMessages(childEvents).messages,
    onEvent: persisted,
    takeNotices: () => twin.checkpoint(),
    externalBudgetExhausted: () => ledger.stopReason(),
  });
  worker = createSession(executionOptions(initial.worker));
  talker = createSession({
    ...initial.talker,
    taskBudget: ledger,
    externalBudgetExhausted: () => ledger.stopReason(),
    sessionId: parentId,
    takeNotices,
    onEvent: persisted,
    completionGuard: () => acceptance.guard(executing || worker.isBusy()),
  });
  worker.subscribe((event) => {
    if (event.type !== "worker.event") recovery.note(event);
    const forwarded = mapped(event);
    if (forwarded.type === "worker.event" && event.type !== "worker.event")
      acceptance.note(event, forwarded.event);
    emit(forwarded);
    if (forwarded.type === "worker.event") note(forwarded.event);
  });
  talker.subscribe((event) => {
    if (event.type === "session.started" && !event.internal) {
      twin.applied(event.prompt);
      acceptance.human(event.prompt);
    }
    if (event.type === "steer.applied") {
      twin.applied(event.text);
      acceptance.human(event.text);
    }
    emit(event);
    if (event.type === "session.finished") schedule();
  });
  return {
    getSessionId: () => parentId,
    getHistory: () => talker.getHistory(),
    // Pool limits/retention must count execution even when the Talker is idle.
    isBusy: () => executing || talker.isBusy() || worker.isBusy() || timer !== undefined,
    peek: () => ({
      ...talker.peek(),
      jobs: talker.peek().jobs + worker.peek().jobs + Number(worker.isBusy()),
      approvals: talker.peek().approvals + worker.peek().approvals,
    }),
    waitsFor: (id) => talker.waitsFor(id) || worker.waitsFor(id),
    subscribe: (listener) => bus.subscribe(listener),
    update(next) {
      Object.assign(options, next);
      if (next.budgets)
        ledger.setLimits({
          maxTokens: next.budgets.maxTokens,
          maxCostUsd: next.budgets.maxCostUsd,
        });
      configuring = configuring
        .then(async () => {
          const roles = await setup.configure(options, control, answer);
          questionOptions = roles.talker;
          talker.update({
            ...roles.talker,
            taskBudget: ledger,
            externalBudgetExhausted: () => ledger.stopReason(),
            onEvent: persisted,
            completionGuard: () => acceptance.guard(executing || worker.isBusy()),
          });
          worker.update(executionOptions(roles.worker));
        })
        .catch(report);
    },
    async send(command: Command): Promise<unknown> {
      if (command.type === "status")
        return {
          ...((await talker.send(command)) as object),
          worker: workerStatus(),
          taskBudget: ledger.view(),
        };
      if (command.type === "stop") {
        executionEpoch++;
        executing = false;
        twin.cancel();
        acceptance.phase("stopped");
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
      if (["subagent.stop", "jobs.stop", "jobs.list"].includes(command.type))
        return worker.send(command);
      if (command.type === "run" && command.summaryWake) {
        talkerRun = talker.send(command);
        return talkerRun;
      }
      await configuring;
      if (command.type === "run") {
        muted = false;
        if (!command.internal) {
          twin.submitted(command.prompt);
          acceptance.human(command.prompt);
        }
        if (talker.isBusy())
          return talker.send({
            type: "queue.add",
            text: command.prompt,
            mode: "steer",
            ...(command.clientId ? { id: command.clientId } : {}),
            ...(command.attachments ? { attachments: command.attachments } : {}),
            ...(command.attachmentSnapshot
              ? { attachmentSnapshot: command.attachmentSnapshot }
              : {}),
            ...(command.contexts ? { contexts: command.contexts } : {}),
          });
        talkerRun = talker.send(command);
        return talkerRun;
      }
      if (command.type === "queue.add" && command.mode === "steer") {
        twin.submitted(command.text);
        acceptance.human(command.text);
      }
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
