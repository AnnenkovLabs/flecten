import { HarnessError } from "../../errors";
import { TerminalManager } from "../../terminal/manager";
import { ToolRegistry } from "../../tools/registry";
import { newId } from "../../util/ids";
import { sessionDictionary } from "../dictionary/session";
import { GoalState } from "../goal/state";
import { ToolCalls } from "../loop/calls";
import { RunQueue } from "../queue/queue";
import { SteeringController } from "../queue/steering";
import type { QueueItemMode } from "../queue/types";
import { runAgent } from "../services/agent";
import { SubagentTasks } from "../subagents/tasks";
import type { Command, Event, Message, ReasoningEffort, RunResult, SessionId } from "../types";
import { ApprovalWaiters } from "./approvals";
import { BUDGET_ABORT, RunBudget } from "./budget";
import { dispatch } from "./commands";
import { SessionCompaction } from "./compaction";
import { drainQueue, followUpMode } from "./drain-queue";
import { createEventBus } from "./event-bus";
import { failureEvent, messageOf, sessionRetryPolicy } from "./failure";
import type { SessionHandle, SessionPeek } from "./handle";
import { notifyJobHook, sessionHookRunner } from "./hooks";
import { JobNotices } from "./jobs";
import { runLanguage, translatedRunInput } from "./language";
import { toolMediaOptions } from "./media";
import { sessionMemory } from "./memory";
import type { SessionOptions } from "./options";
import { SessionPermissionIntent } from "./permission-intent";
import { isPersistentEvent, SessionPersistence } from "./persistence";
import { accountingChanged, runAccounting, taskBudgetEvent } from "./run-accounting";
import { prepareSessionInput, promptWithHookContext } from "./run-input";
import type { ActiveRun, RunExtras, SessionRuntime } from "./runtime";
import { SessionStatePublisher } from "./state";
import { takeSessionSteering } from "./steering";
import { sessionReadsTracker, sessionToolOptions } from "./tool-options";
import { runVision } from "./vision";

export type { SessionHandle, SessionPeek } from "./handle";
export type { SessionOptions } from "./options";
export type { SessionMemory } from "./run-input";
export const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000;
const RECENT_RUNS = 64;
const UNWIRED_MEMORY = new Set(["memory"]);
export function createSession(options: SessionOptions): SessionHandle {
  const bus = createEventBus();
  const readsFor = sessionReadsTracker(RECENT_RUNS);
  const statePublisher = new SessionStatePublisher(options.initialPhase, options.interrupted);
  let active: ActiveRun | undefined;
  let starting = false;
  let holdQueue = false;
  let queuedRun: Promise<RunResult | undefined> | undefined;
  let preparing: AbortController | undefined;
  let goalState: GoalState | undefined;
  let currentSessionId: SessionId | undefined = options.sessionId;
  let historyOf: SessionId | undefined;
  let history: Message[] = [];
  let deferred: Partial<SessionOptions> | undefined;
  const queue = options.queue ? RunQueue.restore(options.queue) : new RunQueue();
  const steering = new SteeringController();
  const permissionIntent = new SessionPermissionIntent();
  for (const item of queue.list()) {
    if (item.mode === "steer" && item.state === "pending") steering.push(item);
  }
  const compaction = new SessionCompaction(options);
  const retryPolicy = sessionRetryPolicy();
  const terminals = new TerminalManager(options.terminal);
  const calls = new ToolCalls();
  const subagents = new SubagentTasks(emit);
  const recentRuns: string[] = [];
  const approvals = new ApprovalWaiters({
    emit,
    permissions: () => options.permissions,
    timeoutMs: () => options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
  });
  const jobs = new JobNotices(terminals, emit, () => active?.sessionId ?? currentSessionId);
  const persistence = new SessionPersistence(options, (error) => {
    active?.controller.abort("persistence_failed");
    bus.emit({
      type: "error",
      ...(currentSessionId ? { sessionId: currentSessionId } : {}),
      code: "log_failed",
      message: `Could not save session: ${messageOf(error)}`,
    });
  });
  function persist(event: Event): void {
    if (!options.onEvent || !isPersistentEvent(event)) return;
    persistence.event(event);
  }
  function saveQueue(): Promise<void> {
    const sessionId = currentSessionId;
    if (sessionId === undefined || !options.saveQueue) return Promise.resolve();
    const snapshot = queue.serialize();
    return persistence.queue(sessionId, snapshot);
  }
  function delivered(queueId: string): void {
    try {
      queue.markSent(queueId);
    } catch {
      return;
    }
    void saveQueue();
  }
  function applyOptions(next: Partial<SessionOptions>): void {
    Object.assign(options, next);
    if (next.terminal) terminals.configure(next.terminal);
  }
  function emit(event: Event): void {
    const changed = statePublisher.note(event);
    bus.emit(event);
    persist(event);
    if (options.taskBudget && accountingChanged(event)) {
      const snapshot = taskBudgetEvent(
        event.sessionId ?? currentSessionId ?? "",
        options.taskBudget,
      );
      bus.emit(snapshot);
      persist(snapshot);
    }
    notifyJobHook(options.hooks, options.cwd, event, emit, options.modules);
    if ((event.type === "session.started" || event.type === "steer.applied") && event.queueId) {
      delivered(event.queueId);
    }
    if (changed) statePublisher.publish(runtime);
  }
  async function prepareRun(
    prompt: string,
    requestedSessionId: string | undefined,
    attachmentPaths: readonly string[],
    extras: RunExtras,
  ) {
    if (extras.queueId) await persistence.flush();
    await compaction.settled();
    let sessionId: SessionId;
    const selected = requestedSessionId ?? (historyOf === undefined ? currentSessionId : undefined);
    if (selected) {
      sessionId = selected;
      if (historyOf !== sessionId) {
        history = options.loadHistory ? [...(await options.loadHistory(sessionId))] : [];
        historyOf = sessionId;
      }
      currentSessionId = sessionId;
    } else {
      sessionId = newId("s");
      currentSessionId = sessionId;
      historyOf = sessionId;
      history = [];
    }
    return prepareSessionInput(prompt, sessionId, history, attachmentPaths, extras, options);
  }
  async function run(
    prompt: string,
    reasoningOverride?: ReasoningEffort,
    requestedSessionId?: string,
    attachmentPaths?: string[],
    extras: RunExtras = {},
  ): Promise<RunResult> {
    if (active || starting) {
      throw new HarnessError("invalid_input", "a run is already active");
    }
    if (prompt.trim().length === 0) {
      throw new HarnessError("invalid_input", "prompt is required");
    }
    if (requestedSessionId && !/^[\w-]+$/.test(requestedSessionId)) {
      throw new HarnessError("invalid_input", "sessionId is invalid");
    }
    const authority = permissionIntent.forRun(options, prompt, extras.internal, extras.actor);
    preparing = new AbortController();
    const controller = preparing;
    starting = true;
    statePublisher.starting();
    const prepared = await prepareRun(prompt, requestedSessionId, attachmentPaths ?? [], extras)
      .catch((error: unknown) => {
        starting = false;
        statePublisher.failed();
        statePublisher.publish(runtime);
        throw error;
      })
      .finally(() => {
        starting = false;
      });
    const { sessionId, expanded, input, attached } = prepared;
    const reasoning = reasoningOverride ?? options.reasoning;
    const goal = new GoalState({
      id: sessionId,
      objective: expanded,
      criteria: [],
      ...(options.goal ? { budget: options.goal } : {}),
    });
    goalState = goal;
    preparing = undefined;
    const budget = new RunBudget(
      options.budgets ?? {},
      options.price,
      Date.now,
      options.taskBudget,
    );
    const state: ActiveRun = {
      sessionId,
      ...(extras.summaryWake ? { summaryWake: true } : {}),
      controller,
      stop: new AbortController(),
      turns: 0,
      usage: { input: 0, output: 0, cached: 0 },
      budget,
    };
    active = state;
    const disarm = budget.arm(() => controller.abort(BUDGET_ABORT));
    const reads = readsFor(sessionId, options.reads);
    const sessionHooks = sessionHookRunner(
      extras.summaryWake ? undefined : options.hooks,
      sessionId,
      options.cwd,
      emit,
      extras.summaryWake ? undefined : options.modules,
    );
    const hooks = sessionHooks.runner;
    const runHooks = sessionHooks.run;
    emit({
      type: "session.started",
      sessionId,
      provider: options.providerId,
      model: options.model,
      ...(options.role ? { role: options.role } : {}),
      prompt,
      ...(input === prompt ? {} : { input }),
      ...(attached.media.length > 0 ? { attachments: attached.media } : {}),
      attachmentSnapshot: attached.snapshot,
      ...(extras.contexts?.length ? { contexts: extras.contexts } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(options.variant ? { variant: options.variant } : {}),
      ...(options.promptStamp && !options.language ? { system: options.promptStamp } : {}),
      ...(extras.queueId ? { queueId: extras.queueId } : {}),
      ...(extras.resumed ? { resumed: true } : {}),
      ...(extras.internal ? { internal: true } : {}),
      ...(extras.actor ? { actor: extras.actor } : {}),
      ...(budget.hasLimits() ? { budget: budget.view() } : {}),
    });
    const budgetStop = (): string | undefined => {
      if (controller.signal.reason !== BUDGET_ABORT) return undefined;
      return budget.reason(budget.exhausted() ?? "wall_clock");
    };
    const loopEvent = runAccounting(options, state, compaction, emit);
    let result: RunResult;
    const language = runLanguage(options, state, emit);
    try {
      controller.signal.throwIfAborted();
      await options.modules?.prepare(sessionId, history, controller.signal);
      await persistence.flush();
      const context: string[] = [];
      const startHook = await runHooks("sessionStart", { prompt }, controller.signal);
      context.push(...(startHook?.context ?? []));
      if (startHook?.blocked)
        throw new HarnessError(
          "invalid_input",
          `Session blocked by hook: ${startHook.reason ?? "sessionStart denied the operation"}`,
        );
      const promptHook = await runHooks("userPromptSubmit", { prompt }, controller.signal);
      context.push(...(promptHook?.context ?? []));
      if (promptHook?.blocked)
        throw new HarnessError(
          "invalid_input",
          `Prompt blocked by hook: ${promptHook.reason ?? "userPromptSubmit denied the operation"}`,
        );
      const hookedInput = promptWithHookContext(input, context);
      const { modelInput, system } = await translatedRunInput(
        language,
        prompt,
        hookedInput,
        history,
        options,
        sessionId,
        emit,
        extras.resumed,
      );
      const memory = sessionMemory(options, sessionId, system, history);
      const dictionary = sessionDictionary(options, prompt, sessionId);
      const loopResult = await runAgent(modelInput, {
        ...(options.role ? { role: options.role } : {}),
        language,
        ...(memory ? { memory } : {}),
        ...(dictionary ? { dictionary } : {}),
        ...authority.input,
        provider: options.provider,
        loadMedia: toolMediaOptions(options, sessionId).loadMedia,
        ...(options.modules && !extras.summaryWake ? { modules: options.modules } : {}),
        tools: extras.summaryWake
          ? new ToolRegistry([], { limits: options.limits })
          : memory
            ? options.tools
            : options.tools.without(UNWIRED_MEMORY),
        system,
        ...(extras.summaryWake
          ? { responseFormat: "conversation" as const }
          : options.responseFormat
            ? { responseFormat: options.responseFormat }
            : {}),
        ...(options.completionGuard ? { completionGuard: options.completionGuard } : {}),
        messages: history,
        ...(attached.parts.length > 0 ? { attachments: attached.parts } : {}),
        compactionState: compaction.state,
        pageWriter: await compaction.writer(sessionId, memory?.checkpoint(), loopEvent),
        takeCompactionRequest: compaction.take,
        retryPolicy,
        goal,
        ...(extras.summaryWake
          ? {}
          : { takeSteering: () => takeSessionSteering(runtime, jobs.take(sessionId)) }),
        budgetExhausted: () => options.externalBudgetExhausted?.() ?? budget.stopReason(),
        calls,
        signal: controller.signal,
        stopSignal: state.stop.signal,
        emit: loopEvent,
        maxTurns: extras.summaryWake ? 1 : options.loop.maxTurns,
        maxTokens: options.maxOutputTokens,
        contextWindow: options.context.window,
        reserveTokens: options.context.reserve,
        ...(options.context.workingSetTokens
          ? { workingSetTokens: options.context.workingSetTokens }
          : {}),
        continuations: options.loop.continuations,
        parallelTools: options.loop.parallelTools,
        ...(hooks ? { hooks } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(options.variant ? { variant: options.variant } : {}),
        toolContext: {
          inspectImage: runVision(options, state, emit),
          saveMedia: toolMediaOptions(options, sessionId).saveMedia,
          subagents,
          waitSignal: state.stop.signal,
          ...(memory ? { memory } : {}),
          ...sessionToolOptions(options, sessionId),
          permissionIntent: authority.read,
          reads,
          ...(options.inheritedApprovals
            ? { approvals: options.inheritedApprovals }
            : options.approvalTimeoutMs === 0
              ? {}
              : { approvals: approvals.gate(options.approvalSessionId ?? sessionId) }),
          terminals,
        },
      });
      const limit = loopResult.stopReason === "stopped" ? budgetStop() : undefined;
      result = {
        sessionId,
        pass: loopResult.stopReason === "done",
        stopReason: limit ? "budget" : loopResult.stopReason,
        summary:
          limit ?? (language ? await language.display(loopResult.summary) : loopResult.summary),
        turns: loopResult.turns,
        usage: state.usage,
        budget: budget.view(),
      };
      if (result.stopReason !== "stopped" && result.stopReason !== "error") {
        await runHooks("stop", { stopReason: result.stopReason }, new AbortController().signal);
      }
    } catch (error) {
      const limit = budgetStop();
      const stopped = controller.signal.aborted || state.stop.signal.aborted;
      const message = messageOf(error);
      if (!stopped) {
        if (goal.status === "active") goal.markBlocked(message);
        emit(failureEvent(sessionId, error, message));
      }
      result = {
        sessionId,
        pass: false,
        stopReason: limit ? "budget" : stopped ? "stopped" : "error",
        summary: limit ?? (stopped ? "" : message),
        turns: state.turns,
        usage: state.usage,
        budget: budget.view(),
      };
    } finally {
      disarm();
    }
    try {
      await runHooks("sessionEnd", { stopReason: result.stopReason }, new AbortController().signal);
    } finally {
      active = undefined;
      if (deferred) {
        const next = deferred;
        deferred = undefined;
        applyOptions(next);
      }
    }
    emit({ type: "session.finished", sessionId, result });
    const mode = followUpMode(result.stopReason, options.role, Boolean(extras.summaryWake));
    if (mode && !controller.signal.aborted && !state.stop.signal.aborted)
      startQueuedRun(sessionId, mode);
    return result;
  }
  function startQueuedRun(sessionId: SessionId, mode: QueueItemMode | "any"): void {
    if (holdQueue) return;
    queuedRun =
      drainQueue(runtime, sessionId, mode, (item, extras) =>
        run(item.text, undefined, sessionId, item.attachments, extras),
      ) ?? queuedRun;
  }
  const runtime: SessionRuntime = {
    options,
    queue,
    steering,
    approvals,
    compaction,
    calls,
    subagents,
    terminals,
    reads: () => readsFor(currentSessionId ?? "", options.reads),
    active: () => active,
    busy: () => active !== undefined || starting,
    state: () => statePublisher.snapshot(runtime),
    sessionId: () => currentSessionId,
    reserveSessionId: () => (currentSessionId ??= newId("s")),
    history: () => history,
    goal: () => goalState,
    emit,
    saveQueue,
  };
  return {
    isBusy: (): boolean => active !== undefined || starting,
    getSessionId: (): SessionId | undefined => currentSessionId,
    peek(): SessionPeek {
      return {
        state: statePublisher.snapshot(runtime),
        running: active !== undefined || starting,
        turns: active?.turns ?? 0,
        queue: queue.list().filter((item) => item.state === "pending").length,
        approvals: approvals.pendingIds().length,
        jobs:
          terminals.listJobs().filter((job) => job.snapshot().status === "running").length +
          subagents.running,
      };
    },
    waitsFor: (approvalId: string): boolean => approvals.pendingIds().includes(approvalId),
    getHistory: (): readonly Message[] => [...history],
    appendHistory: (...messages: Message[]): void => {
      history.push(...messages);
    },
    flush: () => compaction.settled().then(() => persistence.flush()),
    async dispose(): Promise<void> {
      holdQueue = true;
      (preparing ?? active?.controller)?.abort("stopped");
      calls.abortAll(new Error("Session closed"));
      await queuedRun;
      if (currentSessionId) await options.modules?.close(currentSessionId);
      await subagents.dispose();
      jobs.dispose();
      await terminals.closeAll();
      await persistence.flush();
    },
    update(next: Partial<SessionOptions>): void {
      if (active || starting) {
        deferred = { ...deferred, ...next };
        return;
      }
      applyOptions(next);
    },
    subscribe(listener): () => void {
      return bus.subscribe(listener);
    },
    async send(command: Command): Promise<unknown> {
      permissionIntent.beforeCommand(command, options.role, queue.list());
      if (command.type === "stop" && !command.target) {
        holdQueue = true;
        preparing?.abort("stopped");
      }
      if (command.type !== "run") {
        const result = await dispatch(runtime, command);
        if (
          command.type === "queue.add" &&
          (command.mode === "steer" || !runtime.busy()) &&
          options.role === "talker" &&
          currentSessionId
        )
          startQueuedRun(currentSessionId, command.mode === "steer" ? "steer" : "any");
        // A no-op stop still republishes: the caller needs the current state to render its result.
        statePublisher.publish(runtime);
        return result;
      }
      if (command.clientId !== undefined) {
        if (recentRuns.includes(command.clientId)) return { duplicate: true };
        recentRuns.push(command.clientId);
        if (recentRuns.length > RECENT_RUNS) recentRuns.shift();
      }
      if (!command.internal) holdQueue = false;
      return run(command.prompt, command.reasoning, command.sessionId, command.attachments, {
        ...(command.attachmentSnapshot ? { attachmentSnapshot: command.attachmentSnapshot } : {}),
        ...(command.contexts ? { contexts: command.contexts } : {}),
        ...(command.resumed ? { resumed: true } : {}),
        ...(command.internal ? { internal: true } : {}),
        ...(command.actor ? { actor: command.actor } : {}),
        ...(command.summaryWake ? { summaryWake: true } : {}),
      });
    },
  };
}
