import { toolAction } from "../agent";
import type { AgentEvent } from "../agent-protocol";
import { t } from "../i18n.svelte";
import { nextId } from "../run-helpers";
import type { AgentJob, RunAction, WorkerItem } from "../types";
import type { ThreadView } from "./thread.svelte";
import { emptyTokenUsage, tokenUsageEvent } from "./token-usage";

/** Canonical live card state. References and the activity list read the same objects. */
export class WorkerView {
  #current: WorkerItem | undefined;
  usage = $state(emptyTokenUsage());
  jobs = $state<AgentJob[]>([]);
  stopping = $state(false);
  constructor(private readonly thread: ThreadView) {}
  get items(): WorkerItem[] {
    return this.thread.items.filter((item): item is WorkerItem => item.kind === "worker");
  }
  get running(): boolean {
    return this.#current?.status === "running";
  }
  reset(): void {
    this.#current = undefined;
    this.stopping = false;
    this.usage = emptyTokenUsage();
    this.jobs = [];
  }

  disconnected(): void {
    if (this.#current?.status === "running") this.#finish(this.#current, "interrupted");
  }

  apply(envelope: Extract<AgentEvent, { type: "worker.event" }>): void {
    const event = envelope.event;
    this.usage = tokenUsageEvent(this.usage, event);
    if (event.type === "session.started" || !this.#current) {
      this.stopping = false;
      const item: WorkerItem = {
        kind: "worker",
        id: nextId("worker"),
        sessionId: envelope.sessionId,
        status: "running",
        actions: [],
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
      case "session.state":
        this.stopping = event.state.running && (event.state.stopRequested ?? false);
        return;
      case "job.started":
      case "job.finished":
        this.jobs = [event.job, ...this.jobs.filter((job) => job.id !== event.job.id)];
        return;
      case "tool.started":
        this.#set(item, Object.assign(toolAction(event.call), { running: true }));
        return;
      case "tool.output": {
        const action = item.actions.find((entry) => entry.id === event.callId);
        if (action)
          action.detail = {
            ...action.detail,
            output: ((action.detail?.output ?? "") + event.text).slice(-64_000),
          };
        return;
      }
      case "tool.finished":
        this.thread.recordResult(event.result);
        this.#set(item, toolAction(event.call, event.result, event.result.durationMs ?? 0));
        return;
      case "approval.requested":
        this.thread.push({
          kind: "approval",
          id: nextId("apr"),
          sessionId: envelope.sessionId,
          approval: event.approval,
          state: "pending",
          owner: "worker",
        });
        return;
      case "approval.resolved":
        this.thread.resolveApproval(event.id, event.choice, event.by);
        return;
      case "run.interrupted":
        this.#finish(item, "interrupted");
        return;
      case "session.finished":
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

  #finish(item: WorkerItem, status: WorkerItem["status"]): void {
    this.stopping = false;
    item.status = status;
    for (const action of item.actions) {
      if (!action.running) continue;
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
}
