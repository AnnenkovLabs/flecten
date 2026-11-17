import type { WorkerAcceptance } from "../../../../shared/worker-assignment";
import type { AgentEvent } from "../agent-protocol";
import { compactionMeta } from "../context-meter.svelte";
import type { MessageKey } from "../i18n/catalogs";
import { t } from "../i18n.svelte";
import { fallbackReason, retryLabel } from "../run-errors";
import { nextId, nowIso } from "../run-helpers";
import type { AgentJob, ApprovalItem, RunAction, WorkerItem } from "../types";
import { interruptedNotice, interruptedResult, jobNotice } from "./notices";
import { ThreadView } from "./thread.svelte";
import { emptyTokenUsage, tokenUsageEvent } from "./token-usage";

/** Canonical live card state. References and the activity list read the same objects. */
export class WorkerView {
  #current = $state<WorkerItem | undefined>();
  #acceptance = $state<WorkerAcceptance | undefined>();
  #continuationSettled = $state(false);
  #liveLabel = $state<MessageKey>("Thinking");
  #retryKind = $state<string | null>(null);
  readonly transcript = new ThreadView();
  retryUntil = $state(0);
  usage = $state(emptyTokenUsage());
  jobs = $state<AgentJob[]>([]);
  stopping = $state(false);
  constructor(private readonly thread: ThreadView) {}
  get liveLabel(): string {
    if (this.stopping) return t("Waiting for the step to finish");
    if (this.#acceptance?.phase === "reviewing") return t("Reviewing result");
    if (
      this.#acceptance?.phase === "unconfirmed" ||
      (this.#current?.status === "done" &&
        this.#current.acceptance &&
        this.#current.acceptance.phase !== "accepted")
    )
      return t("Completion unconfirmed");
    return this.#retryKind ? retryLabel(this.#retryKind) : t(this.#liveLabel);
  }
  get items(): WorkerItem[] {
    return this.thread.items.filter((item): item is WorkerItem => item.kind === "worker");
  }
  get running(): boolean {
    return (
      this.#current?.status === "running" ||
      this.#acceptance?.phase === "running" ||
      this.#acceptance?.phase === "reviewing"
    );
  }
  get resumable(): boolean {
    return (
      !this.#continuationSettled &&
      (this.#current?.status === "stopped" ||
        this.#current?.status === "interrupted" ||
        this.#current?.status === "error" ||
        this.#acceptance?.phase === "unconfirmed")
    );
  }
  settleContinuation(): void {
    this.#continuationSettled = !this.running;
  }
  reset(): void {
    this.#current = undefined;
    this.#acceptance = undefined;
    this.#continuationSettled = false;
    this.stopping = false;
    this.usage = emptyTokenUsage();
    this.jobs = [];
    this.transcript.clear();
    this.#status("Thinking");
  }

  disconnected(): void {
    if (this.#acceptance?.phase === "running" || this.#acceptance?.phase === "reviewing") {
      this.acceptance({ ...this.#acceptance, phase: "unconfirmed" });
    }
    if (this.#current?.status === "running") {
      this.transcript.finishRun(interruptedResult(this.#current.sessionId));
      this.#finish(this.#current, "interrupted");
    }
  }

  acceptance(state: WorkerAcceptance): void {
    this.#acceptance = state;
    for (const item of this.items) {
      if (item.acceptance?.taskId === state.taskId) item.acceptance = state;
    }
  }

  apply(envelope: Extract<AgentEvent, { type: "worker.event" }>): void {
    const event = envelope.event;
    this.transcript.restoring = this.thread.restoring;
    this.usage = tokenUsageEvent(this.usage, event);
    // Stopping a conversation also publishes an idle snapshot for a Worker that never ran.
    if (!this.#current && event.type === "session.state" && !event.state.running) return;
    if (event.type === "session.started" || !this.#current) {
      this.stopping = false;
      this.#continuationSettled = false;
      this.#status("Thinking");
      this.transcript.beginRun(
        event.type === "session.started" && !event.resumed && !event.internal
          ? (event.prompt ?? null)
          : null,
        new Date(envelope.timestamp ?? Date.now()).toISOString(),
        envelope.timestamp,
      );
      const item: WorkerItem = {
        kind: "worker",
        id: nextId("worker"),
        sessionId: envelope.sessionId,
        status: "running",
        actions: [],
        ...(this.#acceptance ? { acceptance: this.#acceptance } : {}),
      };
      this.thread.push(item);
      // Read the reactive object owned by ThreadView, not the pre-proxy local value.
      this.#current = this.thread.items.find(
        (entry): entry is WorkerItem => entry.kind === "worker" && entry.id === item.id,
      );
    }
    const item = this.#current;
    if (!item) return;
    switch (event.type) {
      case "session.started":
        return;
      case "session.state": {
        this.stopping = event.state.running && (event.state.stopRequested ?? false);
        this.jobs = event.state.jobs;
        if (event.state.approvals.length > 0) this.#status("Awaiting approval");
        else if (event.state.phase === "writing") this.#status("Writing");
        else if (this.#liveLabel === "Awaiting approval") this.#status("Working");
        const pending = new Set(event.state.approvals.map((approval) => approval.id));
        for (const approval of event.state.approvals) {
          if (
            !this.transcript.items.some(
              (entry) => entry.kind === "approval" && entry.approval.id === approval.id,
            )
          ) {
            this.#approval(envelope.sessionId, approval);
          }
        }
        for (const entry of this.transcript.items) {
          if (
            entry.kind === "approval" &&
            entry.state === "pending" &&
            !pending.has(entry.approval.id)
          ) {
            entry.state = "deny";
            entry.by = "aborted";
          }
        }
        for (const resolution of event.state.approvalResolutions ?? []) {
          this.thread.resolveApproval(resolution.id, resolution.choice, resolution.by);
          this.transcript.resolveApproval(resolution.id, resolution.choice, resolution.by);
        }
        if (!event.state.running && item.status === "running") {
          const status = event.state.interrupted
            ? "interrupted"
            : event.state.phase === "failed"
              ? "error"
              : event.state.phase === "stopped"
                ? "stopped"
                : "done";
          this.transcript.finishRun(
            {
              ...interruptedResult(event.sessionId),
              stopReason: status === "done" ? "end" : status === "error" ? "error" : "stopped",
            },
            envelope.timestamp,
          );
          this.#finish(item, status);
        }
        return;
      }
      case "turn.started":
        this.transcript.turnStarted(event.turn, envelope.timestamp);
        this.#status("Thinking");
        return;
      case "reasoning.delta":
        this.transcript.reasoningDelta(event.text, envelope.timestamp);
        this.#status("Thinking");
        return;
      case "message.started":
      case "message.delta":
        this.transcript.appendText(event.type === "message.delta" ? event.text : "");
        this.#status("Writing");
        return;
      case "message.reset":
        this.transcript.messageReset();
        this.#status("Thinking");
        return;
      case "message.finished":
        this.transcript.finishMessage(
          event.display?.text ?? event.text,
          event.display?.reasoning ?? event.reasoning,
          event.toolCalls,
          event.display?.summary ?? event.summary,
          envelope.timestamp,
          envelope.reasoningStartedAt,
        );
        this.#status(event.toolCalls.length > 0 ? "Working" : "Writing");
        return;
      case "tool_call.progress":
        this.transcript.progressToolCall(event.index, event.name, event.delta);
        this.#status("Preparing a call");
        return;
      case "job.started":
      case "job.finished":
        this.jobs = [event.job, ...this.jobs.filter((job) => job.id !== event.job.id)];
        if (event.type === "job.finished") this.transcript.push(jobNotice(event.job));
        return;
      case "tool.started":
        this.#set(item, this.transcript.startTool(event.call));
        this.#status("Working");
        return;
      case "tool.output":
        this.transcript.toolOutput(event.callId, event.text);
        return;
      case "tool.finished":
        this.thread.recordResult(event.result);
        this.#set(item, this.transcript.finishTool(event.call, event.result).action);
        this.#status("Working");
        return;
      case "approval.requested": {
        this.#approval(envelope.sessionId, event.approval);
        this.#status("Awaiting approval");
        return;
      }
      case "approval.resolved":
        this.thread.resolveApproval(event.id, event.choice, event.by);
        this.transcript.resolveApproval(event.id, event.choice, event.by);
        this.#status("Working");
        return;
      case "provider.retry":
        if (!this.thread.restoring) {
          this.#retryKind = event.kind;
          this.retryUntil = event.until;
        }
        return;
      case "turn.finished":
        this.#status("Thinking");
        return;
      case "context.compacted":
        this.transcript.note(
          "layers",
          t("Context compacted"),
          compactionMeta(event),
          event.displaySummary ?? event.summary,
        );
        return;
      case "steer.applied":
        this.transcript.push({
          kind: "message",
          id: nextId("msg"),
          text: event.text,
          at: nowIso(),
        });
        return;
      case "model.fallback":
        this.transcript.note(
          "refresh",
          t("Fallback model {0} responded", [event.model]),
          event.provider,
          fallbackReason(event.reason),
        );
        this.#status("Thinking");
        return;
      case "translation.failed":
        this.transcript.note(
          "refresh",
          t("Untranslated response"),
          t("Translation unavailable"),
          event.message,
        );
        return;
      case "run.interrupted": {
        this.transcript.finishRun(
          interruptedResult(event.sessionId),
          envelope.timestamp ?? event.at,
        );
        const notice = interruptedNotice(event.reason, event.at);
        delete notice.action;
        this.transcript.push(notice);
        this.#finish(item, "interrupted");
        return;
      }
      case "session.finished":
        this.transcript.finishRun(event.result, envelope.timestamp);
        this.#finish(
          item,
          event.result.stopReason === "done" || event.result.stopReason === "end"
            ? "done"
            : event.result.stopReason === "stopped"
              ? "stopped"
              : "error",
        );
        return;
      case "error":
        this.thread.note("x", t("Worker failed"), "", event.message);
        this.transcript.push({
          kind: "error",
          id: nextId("err"),
          text: event.message,
          code: event.code,
          at: nowIso(),
          ...(event.limit ? { limit: event.limit } : {}),
          ...(event.resetAt !== undefined ? { resetAt: event.resetAt } : {}),
        });
        this.#status("Error");
        return;
    }
  }

  #set(item: WorkerItem, action: RunAction): void {
    const index = item.actions.findIndex((entry) => entry.id === action.id);
    // Mirrors resolve from this collection again when a result replaces its live action.
    if (index >= 0) item.actions[index] = action;
    else {
      item.actions.push(action);
      this.thread.push({ kind: "worker-tool", id: nextId("worker-tool"), reference: action.id });
    }
  }

  #approval(sessionId: string, pending: ApprovalItem["approval"]): void {
    const approval = $state<ApprovalItem>({
      kind: "approval",
      id: nextId("apr"),
      sessionId,
      approval: pending,
      state: "pending",
      owner: "worker",
    });
    this.thread.push(approval);
    this.transcript.push(approval);
  }

  #finish(item: WorkerItem, status: WorkerItem["status"]): void {
    this.stopping = false;
    const label: Record<WorkerItem["status"], MessageKey> = {
      running: "Working",
      done: "Done",
      stopped: "Stopped",
      error: "Error",
      interrupted: "Interrupted",
    };
    this.#status(label[status]);
    item.status = status;
    for (const action of item.actions) {
      if (!action.running && action.state !== "interrupted") continue;
      action.running = false;
      action.state = "interrupted";
      action.failed = true;
      action.detail = {
        ...action.detail,
        error: t("Call interrupted; completion was not confirmed"),
      };
    }
    for (const entry of this.thread.items) {
      if (entry.kind === "approval" && entry.owner === "worker" && entry.state === "pending") {
        entry.state = "deny";
        entry.by = "aborted";
      }
    }
  }

  #status(label: MessageKey): void {
    this.#retryKind = null;
    this.retryUntil = 0;
    this.#liveLabel = label;
  }
}
