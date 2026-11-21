import workerNotice from "../../prompts/worker-notice.md" with { type: "text" };
import { wrapUntrusted } from "../core/loop/tool-message";
import { createEventBus } from "../core/session/event-bus";
import { isPersistentEvent, SessionPersistence } from "../core/session/persistence";
import { accountingChanged } from "../core/session/run-accounting";
import { createSession, type SessionHandle, type SessionOptions } from "../core/session/session";
import type { Command, Event, ReasoningEffort, RunResult, SessionEvent } from "../core/types";
import { replayMessages } from "../store/events/replay";
import { restoredQueue } from "../store/queue";
import type { ToolContext } from "../tools/types";
import { ConversationAcceptance } from "./conversation-acceptance";
import { conversationBudget } from "./conversation-budget";
import type { ConversationOptions } from "./conversation-options";
import { restoreWorkerResult } from "./conversation-restore";
import { RESUME_PROMPT } from "./service-commands";
import { SessionTwinDriver } from "./session-twin";
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
  let pendingReasoning: ReasoningEffort | undefined;
  let workerIntent: () => string | undefined = () => undefined;
  let revokeWorkerIntent = () => {};
  let talker: SessionHandle;
  let worker: SessionHandle;
  let twinDriver: SessionTwinDriver | undefined;
  const persistence = new SessionPersistence({ onEvent: (e) => options.onEvent?.(e) }, report);
  const persisted = () => persistence.flush();
  const acceptance = new ConversationAcceptance((state) =>
    emit({ type: "worker.acceptance", sessionId: parentId, acceptance: state }),
  );
  acceptance.restore(setup.events);
  function emit(event: Event): void {
    if (event.type === "worker.acceptance") recovery.note(event);
    if (isPersistentEvent(event)) persistence.event(event);
    bus.emit(event);
    twinDriver?.note(event);
    const inner =
      event.type === "worker.event"
        ? event.event.type === "subagent.event"
          ? event.event.event
          : event.event
        : event.type === "subagent.event"
          ? event.event
          : undefined;
    const budgetChanged = accountingChanged(event) || inner?.type === "task.budget";
    if (event.type !== "task.budget" && budgetChanged) {
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
      const storedResult = notices.get("result");
      const notice = takeNotices()[0];
      if (!notice) return;
      talkerRun = talker.send({
        type: "run",
        sessionId: parentId,
        prompt: notice.text,
        internal: true,
      });
      void talkerRun
        .catch((error: unknown) => {
          if (storedResult && !notices.has("result")) notices.set("result", storedResult);
          report(error);
        })
        .finally(schedule);
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
    if (muted || disposed) {
      if (event.type === "session.finished") lastResult = event.result;
      return;
    }
    if (event.type === "context.compacted" && event.page !== undefined)
      notices.set(
        "progress",
        `Worker checkpointed page ${event.page}:\n${wrapUntrusted(event.summary.slice(0, 2_000), { source: "mcp", ref: workerId })}`,
      );
    if (event.type === "error")
      notices.set(
        "error",
        `Worker error:\n${wrapUntrusted(event.message.slice(0, 2_000), { source: "mcp", ref: workerId })}`,
      );
  }
  function publish(result: RunResult): void {
    if (acceptance.hasOpenCriteria()) result = { ...result, pass: false };
    const isDone = ["done", "end"].includes(result.stopReason);
    const nextPhase =
      result.pass && isDone
        ? "accepted"
        : result.stopReason === "stopped"
          ? "stopped"
          : "unconfirmed";
    acceptance.phase(result.stopReason === "error" ? "error" : nextPhase);
    lastResult = result;
    clearTimeout(timer);
    timer = undefined;
    notices.delete("progress");
    const resultNotice = `Worker status: ${result.stopReason}\n\n${acceptance.markdown()}\n\n${wrapUntrusted([recovery.partial, result.summary.slice(0, 8_000)].filter(Boolean).join("\n\n"), { source: "mcp", ref: workerId })}`;
    notices.set("result", resultNotice);
    if (isDone) schedule();
    else {
      // Failure is already known locally, including quota failure. Do not call the same provider to explain it.
      const text = recovery.partial
        ? `${recovery.partial}\n\nPartial result. Execution stopped: ${result.stopReason}.\n${result.summary}`
        : result.summary;
      notices.delete("result");
      talker.appendHistory?.(
        { role: "user", content: `${workerNotice.trim()}\n\n${resultNotice}`, synthetic: true },
        { role: "assistant", content: text, reasoning: "", toolCalls: [] },
      );
      emit({ type: "message.started", sessionId: parentId });
      emit({
        type: "message.finished",
        sessionId: parentId,
        text,
        reasoning: "",
        toolCalls: [],
        complete: false,
      });
    }
  }
  async function executeTask(
    task: string,
    epoch: number,
    reasoning?: ReasoningEffort,
    resumed?: boolean,
  ): Promise<void> {
    try {
      if (disposed || muted || epoch !== executionEpoch) return;
      const result = (await worker.send({
        type: "run",
        sessionId: workerId,
        prompt: task,
        ...(reasoning ? { reasoning } : {}),
        ...(resumed ? { resumed: true } : {}),
      })) as RunResult;
      if (disposed || muted || epoch !== executionEpoch) return;
      acceptance.reviewing(result);
      if (result.stopReason !== "done" && result.stopReason !== "end") {
        publish(result);
        return;
      }
      const passed = !acceptance.hasOpenCriteria() && ["done", "end"].includes(result.stopReason);
      publish({ ...result, pass: passed });
    } catch (error) {
      if (!disposed && !muted && epoch === executionEpoch) {
        acceptance.phase("error");
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
        ...request,
        sessionId: parentId,
        workerId,
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
      executing = false;
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
    const reasoning = pendingReasoning;
    pendingReasoning = undefined;
    executing = true;
    workerRun = executeTask(task, ++executionEpoch, reasoning, request.operation === "resume");
    return { workerId, state: "running", acceptance: acceptance.state };
  }
  const initial = await setup.configure(options, control);
  let questionOptions = initial.talker;
  await options.modules?.shareSession?.(parentId, workerId);
  const childEvents = setup.events.flatMap((event, index) =>
    event.type === "worker.event" ? [{ seq: index + 1, event: event.event }] : [],
  );
  const isAccepted = !acceptance.state || acceptance.state.phase === "accepted";
  lastResult = restoreWorkerResult(setup.events, childEvents, notices, isAccepted);
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
    if (event.type === "session.started" && !event.internal && event.actor !== "twin")
      acceptance.human(event.prompt);
    if (event.type === "steer.applied" && event.actor !== "twin") acceptance.human(event.text);
    emit(event);
    if (event.type === "session.finished") schedule();
  });
  let handle: SessionHandle;
  if (setup.twin)
    twinDriver = new SessionTwinDriver(
      {
        ...setup,
        sessionId: () => parentId,
        ledger,
        emit,
        sendToChat: (c) => handle.send(c),
        sendToWorker: (c) => worker.send(c),
      },
      setup.events,
    );
  handle = {
    getSessionId: () => parentId,
    getHistory: () => talker.getHistory(),
    appendHistory: (...messages) => talker.appendHistory?.(...messages),
    isBusy: () =>
      executing ||
      talker.isBusy() ||
      worker.isBusy() ||
      timer !== undefined ||
      talker.peek().jobs + worker.peek().jobs > 0,
    peek: () => ({
      ...talker.peek(),
      queue: talker.peek().queue + worker.peek().queue,
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
          const roles = await setup.configure(options, control);
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
        executing = false;
        acceptance.phase("stopped");
        if (command.target === "worker")
          return worker.send({ type: "stop", ...(command.mode ? { mode: command.mode } : {}) });
        executionEpoch++;
        muted = true;
        clearTimeout(timer);
        timer = undefined;
        notices.clear();
        return Promise.all([talker.send(command), worker.send(command)]);
      }
      if (command.type === "approval.respond" && worker.waitsFor(command.id))
        return worker.send(command);
      if (command.type === "approval.allowAll" || command.type === "approval.denyAll")
        return Promise.all([
          talker.send({ ...command, ids: command.ids.filter((id) => !worker.waitsFor(id)) }),
          worker.send({ ...command, ids: command.ids.filter((id) => worker.waitsFor(id)) }),
        ]);
      if (command.type === "tool.cancel") {
        const raw = references.raw(command.callId);
        if (raw) return worker.send({ ...command, callId: raw });
        if (command.callId.startsWith("w_")) return { cancelled: false };
      }
      if (command.type === "subagent.stop" || command.type === "jobs.list") {
        const [w, t] = await Promise.all([worker.send(command), talker.send(command)]);
        return command.type === "subagent.stop"
          ? { stopped: (w as { stopped: boolean }).stopped || (t as { stopped: boolean }).stopped }
          : { jobs: [...(w as { jobs: unknown[] }).jobs, ...(t as { jobs: unknown[] }).jobs] };
      }
      if (command.type === "jobs.stop") {
        const w = (await worker.send(command)) as { job: unknown };
        return w.job ? w : talker.send(command);
      }
      if (command.type === "run" && command.summaryWake) {
        talkerRun = talker.send(command);
        return talkerRun;
      }
      await configuring;
      if (command.type === "run") {
        muted = false;
        if (command.reasoning) pendingReasoning = command.reasoning;
        if (
          !command.internal &&
          (command.resumed || command.prompt.trim() === RESUME_PROMPT) &&
          !executing &&
          !worker.isBusy() &&
          acceptance.state &&
          acceptance.state.phase !== "accepted"
        ) {
          lastResult = undefined;
          notices.clear();
          const reasoning = pendingReasoning;
          pendingReasoning = undefined;
          executing = true;
          workerRun = executeTask(
            `${acceptance.resume()}\n\n${recovery.markdown()}`,
            ++executionEpoch,
            reasoning,
            true,
          );
          await workerRun;
          return lastResult;
        }
        if (!command.internal && command.actor !== "twin") acceptance.human(command.prompt);
        const { reasoning: _r, ...talkerCmd } = command;
        if (!talker.isBusy()) {
          talkerRun = talker.send(talkerCmd);
          return talkerRun;
        }
        command = {
          ...talkerCmd,
          type: "queue.add",
          text: command.prompt,
          mode: "steer",
          ...(command.clientId ? { id: command.clientId } : {}),
        };
      }
      if (command.type === "queue.add" && command.mode === "steer" && command.actor !== "twin")
        acceptance.human(command.text);
      return talker.send(command);
    },
    async flush() {
      await Promise.all([talker.flush(), worker.flush()]);
      await persistence.flush();
    },
    async dispose() {
      disposed = true;
      twinDriver?.dispose();
      executionEpoch++;
      clearTimeout(timer);
      await Promise.all([talker.send({ type: "stop" }), worker.send({ type: "stop" })]);
      await Promise.allSettled([talkerRun, workerRun, configuring]);
      await Promise.all([talker.dispose(), worker.dispose()]);
    },
  };
  return handle;
}
