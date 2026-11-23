import type { HookRun } from "../../../../shared/hooks";
import {
  newerSessionState,
  type SessionState,
  SessionStateSchema,
} from "../../../../shared/session-state";
import type { QueuedMessage } from "../composer/types";
import { ContextMeter, compactionMeta, contextWarning } from "../context-meter.svelte";
import type { MessageKey } from "../i18n/catalogs";
import { t } from "../i18n.svelte";
import { clearRetry, setRetry } from "../retry-status.svelte";
import { retryLabel } from "../run-errors";
import { nextId, nowIso } from "../run-helpers";
import type { Phase } from "../run-machine";
import { toast } from "../toast.svelte";
import type { AgentBudget, AgentEvent, AgentInfo, AgentJob, AgentRunResult } from "../types";
import {
  budgetNotice,
  fallbackNotice,
  interruptedNotice,
  interruptedResult,
  jobNotice,
  resumedNotice,
  syncThreadApprovals,
} from "./notices";
import { SubagentsView } from "./subagents.svelte";
import { ThreadView } from "./thread.svelte";
import { hasCheckpoint as hasWorkerCheckpoint } from "./thread-artifacts";
import { conversationUsage, emptyTokenUsage, tokenUsageEvent } from "./token-usage";
import { TwinView } from "./twin-view.svelte";
import { WorkerView } from "./worker.svelte";

export type SessionEvent = Extract<AgentEvent, { sessionId: string }>;
export type ErrorEvent = Extract<AgentEvent, { type: "error" }>;
export interface ViewHooks {
  /** A tool call saved a checkpoint: the history pane reloads. */
  checkpointSaved(): void;
}
export class TaskView {
  state = $state<SessionState | null>(null);
  pendingSend = $state(false);
  #disconnected = $state(false);
  isTalker = $state(false);
  live = $state(false);
  #liveLabel = $state<MessageKey>("Working");
  #retryKind = $state<string | null>(null);
  title = $state("");
  hookRuns = $state<HookRun[]>([]);
  queued = $state<QueuedMessage[]>([]);
  #jobs = $state<AgentJob[]>([]);
  get jobs() {
    return [...this.#jobs, ...this.worker.jobs];
  }
  budget = $state<AgentBudget | null>(null);
  taskBudget = $state<AgentBudget | null>(null);
  readonly context = new ContextMeter();
  #usage = $state(emptyTokenUsage());
  get usage() {
    return conversationUsage(this.#usage, this.worker.usage);
  }
  readonly thread = new ThreadView();
  readonly worker = new WorkerView(this.thread);
  readonly twin = new TwinView();
  readonly subagents = new SubagentsView();
  lastPrompt = "";
  readonly #hooks: ViewHooks;
  /** The run on screen was sent from this window: its state is already projected. */
  #localStart: "message" | "continuation" | null = null;
  #retiredEpochs = new Set<string>();
  generation = 0;
  constructor(hooks: ViewHooks) {
    this.#hooks = hooks;
  }
  get phase(): Phase {
    return this.state?.phase ?? "idle";
  }
  get busy(): boolean {
    return (
      !this.#disconnected &&
      (this.twin.busy || this.worker.running || this.pendingSend || (this.state?.running ?? false))
    );
  }
  get stopping(): boolean {
    return this.busy && (this.worker.stopping || (this.state?.stopRequested ?? false));
  }
  get resumable(): boolean {
    return (
      !this.busy &&
      (this.phase === "stopped" ||
        this.phase === "failed" ||
        this.state?.interrupted === true ||
        this.worker.resumable)
    );
  }
  get liveLabel(): string {
    return this.stopping
      ? t("Waiting for the step to finish")
      : this.#retryKind
        ? retryLabel(this.#retryKind)
        : t(this.#liveLabel);
  }
  set liveLabel(label: MessageKey) {
    this.#retryKind = null;
    this.#liveLabel = label;
  }
  reset(title = ""): void {
    this.generation += 1;
    this.thread.clear();
    this.hookRuns = [];
    this.worker.reset();
    this.twin.reset();
    this.subagents.reset();
    this.state = null;
    this.#retiredEpochs.clear();
    this.pendingSend = false;
    this.#disconnected = false;
    this.isTalker = false;
    this.live = false;
    this.liveLabel = "Working";
    this.title = title;
    this.queued = [];
    this.#jobs = [];
    this.budget = null;
    this.taskBudget = null;
    this.context.reset();
    this.#usage = emptyTokenUsage();
    this.lastPrompt = "";
    this.#localStart = null;
  }
  begin(prompt: string): void {
    this.thread.beginRun(prompt, nowIso());
    this.lastPrompt = prompt;
    this.#localStart = "message";
    this.pendingSend = true;
    this.live = true;
    this.liveLabel = "Thinking";
    this.title ||= prompt.split("\n")[0]?.slice(0, 72) ?? "";
  }
  beginContinuation(): void {
    this.thread.continueRun(Date.now(), true);
    this.#localStart = "continuation";
    this.pendingSend = true;
    this.live = true;
    this.liveLabel = "Thinking";
  }
  /** A run that never reached the core, or a core that refused to start it. */
  failed(text: string, code: string): void {
    this.#rollbackLocal();
    this.pendingSend = false;
    this.live = false;
    this.liveLabel = "Error";
    this.thread.pendingCalls = [];
    this.thread.push({ kind: "error", id: nextId("err"), text, code, at: nowIso() });
  }
  upsertJob(job: AgentJob): void {
    const others = this.#jobs.filter((entry) => entry.id !== job.id);
    this.#jobs = [job, ...others].sort((left, right) => right.startedAt - left.startedAt);
  }
  /** Rebuilds the thread from stored and replayed events without toasts. */
  restore(events: readonly AgentEvent[]): void {
    this.thread.restoring = true;
    try {
      for (const event of events) {
        if (event.type === "error") this.error(event);
        else if ("sessionId" in event && typeof event.sessionId === "string")
          this.apply(event as SessionEvent);
      }
    } finally {
      this.thread.restoring = false;
      this.worker.transcript.restoring = false;
      this.#syncSubagents();
    }
  }
  /** The core's view of the task after a rebuild: queue, jobs, budget and live approvals. */
  attach(info: AgentInfo | undefined): void {
    if (info?.budget) this.budget = info.budget;
    if (info?.taskBudget) this.taskBudget = info.taskBudget;
    if (info?.context) this.context.apply(info.context);
    if (info?.sessionState) this.applyState(info.sessionState);
    const worker = (info as { worker?: { state?: SessionState; acceptance?: never } })?.worker;
    if (worker?.acceptance) this.worker.acceptance(worker.acceptance);
    if (worker?.state) this.worker.attachState(worker.state, info?.sessionId);
  }

  applyState(input: SessionState): void {
    const state = SessionStateSchema.parse(input);
    if (!newerSessionState(this.state, state, this.#retiredEpochs)) return;
    if (this.state && this.state.epoch !== state.epoch) this.#retiredEpochs.add(this.state.epoch);
    this.state = state;
    this.pendingSend = false;
    this.#disconnected = false;
    this.queued = state.queue
      .filter((item) => item.state === "pending")
      .map((item) => ({
        id: item.id,
        text: item.text,
        mode: item.mode,
        state: "pending" as const,
        ...(item.attachments ? { attachments: item.attachments } : {}),
        ...(item.contexts ? { contexts: item.contexts } : {}),
      }));
    this.#jobs = state.jobs;
    syncThreadApprovals(this.thread.items, state, (item) => this.thread.push(item));
    this.live = state.running;
    if (state.approvals.length > 0) this.liveLabel = "Awaiting approval";
  }

  /** The core process went away: the run on screen is no longer streaming. */
  coreLost(): void {
    this.thread.pendingCalls = [];
    this.thread.interruptTools();
    this.live = false;
    this.pendingSend = false;
    this.worker.disconnected();
    this.twin.disconnected();
    this.subagents.disconnected();
    this.#disconnected = true;
    this.liveLabel = "Core restarting";
  }

  error(event: ErrorEvent): void {
    if (event.sessionId) {
      if (event.code === "run_failed") this.#rollbackLocal();
      this.#localStart = null;
      this.live = false;
      this.liveLabel = "Error";
      this.thread.pendingCalls = [];
      if (event.code === "run_failed") this.pendingSend = false;
    }
    this.thread.push({
      kind: "error",
      id: nextId("err"),
      text: event.message,
      code: event.code,
      at: nowIso(),
      ...(event.limit ? { limit: event.limit } : {}),
      ...(event.resetAt ? { resetAt: event.resetAt } : {}),
    });
  }
  apply(event: SessionEvent): void {
    this.#usage = tokenUsageEvent(this.#usage, event);
    if (event.type === "twin.activity") {
      this.twin.apply(event.activity);
      return;
    }
    if (event.type !== "provider.retry") clearRetry();
    const restoring = this.thread.restoring;
    switch (event.type) {
      case "worker.acceptance":
        this.worker.acceptance(event.acceptance);
        return;
      case "hook.finished":
        this.hookRuns = [...this.hookRuns.slice(-49), event.hook];
        return;
      case "subagent.started":
      case "subagent.event":
      case "subagent.finished":
        this.subagents.apply(event);
        this.#syncSubagents();
        return;
      case "worker.event":
        if (
          event.event.type === "subagent.started" ||
          event.event.type === "subagent.event" ||
          event.event.type === "subagent.finished"
        ) {
          this.subagents.apply(event.event, event);
          this.#syncSubagents();
          return;
        }
        if (
          event.event.type === "session.started" &&
          this.#localStart === "continuation" &&
          !restoring
        ) {
          this.#localStart = null;
          this.pendingSend = false;
          this.thread.abortContinuation();
          this.thread.settleNotices();
          this.live = this.state?.running ?? false;
        }
        this.worker.apply(event);
        this.#syncSubagents();
        if (event.event.type === "context.usage") {
          const threshold = this.context.apply(event.event);
          if (threshold !== undefined && !restoring) toast.show(contextWarning(threshold));
        } else if (event.event.type === "context.compacted") this.context.compacted();
        else if (
          event.event.type === "tool.finished" &&
          hasWorkerCheckpoint(event.event.result) &&
          !restoring
        )
          this.#hooks.checkpointSaved();
        return;
      case "tool.output":
        this.thread.toolOutput(event.callId, event.text);
        return;
      case "session.state":
        this.applyState(event.state);
        return;
      case "session.started":
        this.#started(event);
        return;
      case "steer.applied":
        this.thread.push({
          kind: "message",
          id: nextId("msg"),
          text: event.text,
          ...(event.actor ? { actor: event.actor } : {}),
          at: nowIso(),
        });
        return;
      case "notice.applied":
        this.thread.note(
          "terminal",
          t("The model received the background command result"),
          "",
          event.text,
        );
        return;
      case "turn.started":
        this.thread.turnStarted(event.turn, event.timestamp);
        this.liveLabel = "Thinking";
        return;
      case "reasoning.delta":
        this.thread.reasoningDelta(event.text, event.timestamp);
        this.live = true;
        this.liveLabel = "Thinking";
        return;
      case "tool_call.progress":
        this.thread.progressToolCall(event.index, event.name, event.delta);
        this.live = true;
        this.liveLabel = "Preparing a call";
        return;
      case "message.started":
      case "message.delta":
        this.thread.appendText(event.type === "message.delta" ? event.text : "");
        this.live = true;
        this.liveLabel = "Writing";
        return;
      case "message.finished":
        this.thread.finishMessage(
          event.display?.text ?? event.text,
          event.display?.reasoning ?? event.reasoning,
          event.toolCalls,
          event.display?.summary ?? event.summary,
          event.timestamp,
          event.reasoningStartedAt,
        );
        if (event.toolCalls.length > 0) this.liveLabel = "Working";
        return;
      case "message.reset":
        this.thread.messageReset();
        this.live = true;
        return;
      case "translation.failed":
        this.thread.note(
          "refresh",
          t("Untranslated response"),
          t("Translation unavailable"),
          event.message,
        );
        if (!restoring) toast.show(event.message);
        return;
      case "input.translated":
        return;
      case "model.fallback": {
        const notice = fallbackNotice(event);
        this.thread.note("refresh", notice.label, notice.meta, notice.details);
        if (!restoring) toast.show(notice.toast);
        return;
      }
      case "provider.retry":
        if (restoring) return;
        setRetry(event.until, event.kind);
        this.live = true;
        this.#retryKind = event.kind;
        return;
      case "tool.started":
        this.live = true;
        this.liveLabel = "Working";
        this.thread.startTool(event.call);
        this.#syncSubagents();
        return;
      case "tool.finished": {
        const { checkpoint } = this.thread.finishTool(event.call, event.result);
        this.#syncSubagents();
        if (checkpoint && !restoring) this.#hooks.checkpointSaved();
        return;
      }
      case "context.usage": {
        const threshold = this.context.apply(event);
        if (threshold !== undefined && !restoring) toast.show(contextWarning(threshold));
        return;
      }
      case "context.compacted":
        this.context.compacted();
        this.thread.note(
          "layers",
          t("Context compacted"),
          compactionMeta(event),
          event.displaySummary ?? event.summary,
        );
        return;
      case "turn.finished":
        this.liveLabel = "Thinking";
        return;
      case "approval.requested":
        this.thread.push({
          kind: "approval",
          id: nextId("apr"),
          sessionId: event.sessionId,
          approval: event.approval,
          state: "pending",
        });
        this.liveLabel = "Awaiting approval";
        return;
      case "approval.resolved":
        this.thread.resolveApproval(event.id, event.choice, event.by);
        if (this.busy) this.liveLabel = "Working";
        return;
      case "job.started":
        this.upsertJob(event.job);
        return;
      case "job.finished":
        this.upsertJob(event.job);
        this.thread.push(jobNotice(event.job));
        if (event.checkpoint !== undefined && !restoring) this.#hooks.checkpointSaved();
        return;
      case "task.budget":
        this.taskBudget = event.budget;
        return;
      case "budget":
        this.budget = event.budget;
        return;
      case "run.interrupted":
        this.thread.finishRun(interruptedResult(event.sessionId), event.timestamp ?? event.at);
        this.thread.push(interruptedNotice(event.reason, event.at));
        this.live = false;
        this.liveLabel = "Interrupted";
        return;
      case "session.finished":
        this.#finished(event.result, event.timestamp);
        return;
    }
  }
  #started(event: Extract<SessionEvent, { type: "session.started" }>): void {
    this.isTalker = event.role === "talker";
    const prompt = event.prompt ?? "";
    const local = this.#localStart !== null && !event.queueId && !this.thread.restoring;
    this.#localStart = null;
    if (!event.internal) this.worker.settleContinuation();
    this.thread.settleNotices();
    if (local) this.thread.startClock(event.timestamp);
    else if (event.continuation) this.thread.continueRun(event.timestamp);
    else if (event.resumed || event.internal) {
      this.thread.beginRun(null, undefined, event.timestamp);
      if (event.resumed) this.thread.push(resumedNotice());
    } else {
      const at = new Date(event.timestamp ?? Date.now()).toISOString();
      this.thread.beginRun(prompt, at, event.timestamp, event.actor);
      this.lastPrompt = prompt;
      if (event.actor !== "twin") this.title ||= prompt.split("\n")[0]?.slice(0, 72) ?? "";
    }
    if (event.budget) this.budget = event.budget;
    this.pendingSend = false;
    this.live = true;
    this.liveLabel = "Thinking";
  }
  #finished(result: AgentRunResult, timestamp?: number): void {
    this.thread.finishRun(result, timestamp);
    this.#syncSubagents();
    if (result.budget) this.budget = result.budget;
    if (result.stopReason === "budget") this.thread.push(budgetNotice(result));
    this.live = false;
    this.liveLabel = "Done";
  }
  #rollbackLocal(): void {
    if (this.#localStart === "message" && this.thread.items.at(-1)?.kind === "message")
      this.thread.items.pop();
    else if (this.#localStart === "continuation") this.thread.abortContinuation();
    this.#localStart = null;
  }
  #syncSubagents(): void {
    if (this.thread.restoring) return;
    this.subagents.syncActions(this.thread);
    this.subagents.syncActions(this.worker.transcript);
  }
}
