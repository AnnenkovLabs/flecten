import type { HookRun } from "../../../../shared/hooks";
import {
  newerSessionState,
  type SessionState,
  SessionStateSchema,
} from "../../../../shared/session-state";
import type { QueuedMessage } from "../composer/types";
import { ContextMeter, compactionMeta, contextWarning } from "../context-meter.svelte";
import type { MessageKey } from "../i18n/catalogs";
import { i18n, t } from "../i18n.svelte";
import { formatModelName } from "../model-name";
import { clearRetry, setRetry } from "../retry-status.svelte";
import { fallbackReason, retryLabel } from "../run-errors";
import { nextId, nowIso } from "../run-helpers";
import type { Phase } from "../run-machine";
import { toast } from "../toast.svelte";
import type { AgentBudget, AgentEvent, AgentInfo, AgentJob, AgentRunResult } from "../types";
import {
  budgetNotice,
  interruptedNotice,
  interruptedResult,
  jobNotice,
  resumedNotice,
} from "./notices";
import { SubagentsView } from "./subagents.svelte";
import { hasCheckpoint as hasWorkerCheckpoint, ThreadView } from "./thread.svelte";
import { conversationUsage, emptyTokenUsage, tokenUsageEvent } from "./token-usage";
import { TwinView } from "./twin-view.svelte";
import { WorkerView } from "./worker.svelte";

export type SessionEvent = Extract<AgentEvent, { sessionId: string }>;
export type ErrorEvent = Extract<AgentEvent, { type: "error" }>;

export interface ViewHooks {
  /** A tool call saved a checkpoint: the history pane reloads. */
  checkpointSaved(): void;
}

/**
 * The task on screen: its thread, live status line, queue strip, jobs and budget. The run
 * store routes only this task's events here; other tasks keep running behind it.
 */
export class TaskView {
  state = $state<SessionState | null>(null);
  pendingSend = $state(false);
  #disconnected = $state(false);
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
  readonly context = new ContextMeter();
  #usage = $state(emptyTokenUsage());
  get usage() {
    return conversationUsage(this.#usage, this.worker.usage);
  }
  readonly thread = new ThreadView();
  readonly worker = new WorkerView(this.thread);
  readonly twin = new TwinView();
  readonly subagents = new SubagentsView();
  /** The prompt of the latest run, for «Повторить». */
  lastPrompt = "";
  readonly #hooks: ViewHooks;
  /** The run on screen was sent from this window: its message is already in the thread. */
  #localStart = false;
  #retiredEpochs = new Set<string>();

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
    this.thread.clear();
    this.hookRuns = [];
    this.worker.reset();
    this.twin.reset();
    this.subagents.reset();
    this.state = null;
    this.#retiredEpochs.clear();
    this.pendingSend = false;
    this.#disconnected = false;
    this.live = false;
    this.liveLabel = "Working";
    this.title = title;
    this.queued = [];
    this.#jobs = [];
    this.budget = null;
    this.context.reset();
    this.#usage = emptyTokenUsage();
    this.lastPrompt = "";
    this.#localStart = false;
  }

  /** The user sent a run: the message shows at once, before the core answers. */
  begin(prompt: string): void {
    this.thread.beginRun(prompt, nowIso());
    this.lastPrompt = prompt;
    this.#localStart = true;
    this.pendingSend = true;
    this.live = true;
    this.liveLabel = "Thinking";
    this.title ||= prompt.split("\n")[0]?.slice(0, 72) ?? "";
  }

  /** A run that never reached the core, or a core that refused to start it. */
  failed(text: string, code: string): void {
    this.#localStart = false;
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

  /** Rebuilds the thread from stored and replayed events, without timers or toasts. */
  restore(events: readonly AgentEvent[]): void {
    this.thread.restoring = true;
    try {
      for (const event of events) {
        if (event.type === "error") this.error(event);
        else if ("sessionId" in event && typeof event.sessionId === "string") {
          this.apply(event as SessionEvent);
        }
      }
    } finally {
      this.thread.restoring = false;
    }
  }

  /** The core's view of the task after a rebuild: queue, jobs, budget and live approvals. */
  attach(info: AgentInfo | undefined): void {
    if (info?.budget) this.budget = info.budget;
    if (info?.context) this.context.apply(info.context);
    if (info?.sessionState) this.applyState(info.sessionState);
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
    const waiting = new Map(state.approvals.map((approval) => [approval.id, approval]));
    const resolutions = new Map(
      (state.approvalResolutions ?? []).map((entry) => [entry.id, entry]),
    );
    for (const item of this.thread.items) {
      if (item.kind !== "approval" || item.owner === "worker") continue;
      if (waiting.has(item.approval.id)) waiting.delete(item.approval.id);
      else if (resolutions.has(item.approval.id)) {
        const resolved = resolutions.get(item.approval.id);
        if (resolved) {
          item.state = resolved.choice;
          item.by = resolved.by;
        }
      } else if (item.state === "pending") {
        item.state = "deny";
        item.by = "aborted";
      }
    }
    for (const approval of waiting.values())
      this.thread.push({
        kind: "approval",
        id: nextId("apr"),
        sessionId: state.sessionId,
        approval,
        state: "pending",
      });
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
      this.#localStart = false;
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
          this.subagents.apply(event.event);
          this.#syncSubagents();
          return;
        }
        this.worker.apply(event);
        this.#syncSubagents();
        if (
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
        this.thread.push({ kind: "message", id: nextId("msg"), text: event.text, at: nowIso() });
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
        this.thread.turnStarted(event.turn);
        this.#status("Thinking");
        return;
      case "reasoning.delta":
        this.thread.reasoningDelta(event.text);
        this.live = true;
        this.#status("Thinking");
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
        this.#status("Writing");
        return;
      case "message.finished":
        this.thread.finishMessage(
          event.display?.text ?? event.text,
          event.display?.reasoning ?? event.reasoning,
          event.toolCalls,
          event.display?.summary ?? event.summary,
        );
        if (event.toolCalls.length > 0) this.#status("Working");
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
        const name = formatModelName(event.model);
        const why = fallbackReason(event.reason);
        this.thread.note(
          "refresh",
          t("Fallback model {0} responded", [name]),
          event.provider,
          t("{0}{1}: request sent to {2}, model {3}.", [
            why.charAt(0).toLocaleUpperCase(i18n.locale),
            why.slice(1),
            event.provider,
            event.model,
          ]),
        );
        if (!restoring) toast.show(t("Fallback model {0} is responding: {1}", [name, why]));
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
        this.#status("Thinking");
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
        if (this.busy) this.#status("Working");
        return;
      case "job.started":
        this.upsertJob(event.job);
        return;
      case "job.finished":
        this.upsertJob(event.job);
        this.thread.push(jobNotice(event.job));
        if (event.checkpoint !== undefined && !restoring) this.#hooks.checkpointSaved();
        return;
      case "budget":
        this.budget = event.budget;
        return;
      case "run.interrupted":
        this.thread.finishRun(interruptedResult(event.sessionId));
        this.thread.push(interruptedNotice(event.reason, event.at));
        this.live = false;
        this.#status("Interrupted");
        return;
      case "session.finished":
        this.#finished(event.result);
        return;
    }
  }

  #started(event: Extract<SessionEvent, { type: "session.started" }>): void {
    const prompt = event.prompt ?? "";
    const local = this.#localStart && !event.queueId && !this.thread.restoring;
    this.#localStart = false;
    this.thread.settleNotices();
    if (local) this.thread.startClock();
    else if (event.resumed) {
      this.thread.beginRun(null);
      this.thread.push(resumedNotice());
    } else if (event.internal) {
      this.thread.beginRun(null);
    } else {
      this.thread.beginRun(prompt, nowIso());
      this.lastPrompt = prompt;
      this.title ||= prompt.split("\n")[0]?.slice(0, 72) ?? "";
    }
    if (event.budget) this.budget = event.budget;
    this.pendingSend = false;
    this.live = true;
    this.#status("Thinking");
  }

  #finished(result: AgentRunResult): void {
    this.thread.finishRun(result);
    this.#syncSubagents();
    if (result.budget) this.budget = result.budget;
    if (result.stopReason === "budget") this.thread.push(budgetNotice(result));
    this.live = false;
    this.#status("Done");
  }

  #status(label: MessageKey): void {
    this.liveLabel = label;
  }

  #syncSubagents(): void {
    for (const item of this.subagents.items) {
      const action = this.subagents.action(item);
      for (const row of this.thread.items) {
        const actions =
          row.kind === "run" ? row.summary.list : row.kind === "worker" ? row.actions : [];
        const index = actions.findIndex((entry) => entry.id === item.callId);
        if (index >= 0) actions[index] = action;
        if (row.kind === "run")
          for (const turn of row.summary.turns) {
            const position = turn.actions.findIndex((entry) => entry.id === item.callId);
            if (position >= 0) turn.actions[position] = action;
          }
      }
    }
  }
}
