import {
  newerSessionState,
  type SessionState,
  SessionStateSchema,
} from "../../../../shared/session-state";
import type { AgentEvent, AgentSessionActivity } from "../types";

export interface TaskState {
  running: boolean;
  approvals: number;
  jobs: number;
  interrupted: boolean;
}

const IDLE: TaskState = { running: false, approvals: 0, jobs: 0, interrupted: false };

/**
 * What every task is doing, for the task list: running, waiting for permission, holding
 * background jobs, or interrupted by a crash. The task on screen and the ones behind it
 * share this state, so switching tasks never stops a run.
 */
export class TaskActivity {
  tasks = $state<Record<string, TaskState>>({});
  /** Sessions the core holds a handle for: only those have a live status to ask for. */
  #workers = $state<Record<string, TaskState>>({});
  #states = new Map<string, SessionState>();
  #retiredEpochs = new Map<string, Set<string>>();

  of(sessionId: string): TaskState {
    const talker = this.tasks[sessionId] ?? IDLE;
    const worker = this.#workers[sessionId] ?? IDLE;
    return {
      running: talker.running || worker.running,
      approvals: talker.approvals + worker.approvals,
      jobs: talker.jobs + worker.jobs,
      interrupted: talker.interrupted || worker.interrupted,
    };
  }

  clear(): void {
    this.tasks = {};
    this.#workers = {};
    this.#states.clear();
    this.#retiredEpochs.clear();
  }

  /** The core's own counters, sent with every status. */
  sync(activity: readonly AgentSessionActivity[]): void {
    const next: Record<string, TaskState> = {};
    for (const [id, state] of Object.entries(this.tasks)) {
      if (state.interrupted) next[id] = { ...IDLE, interrupted: true };
    }
    for (const entry of activity) {
      next[entry.sessionId] = {
        running: entry.running,
        approvals: entry.approvals,
        jobs: entry.jobs,
        interrupted: !entry.running && (next[entry.sessionId]?.interrupted ?? false),
      };
    }
    this.tasks = next;
    for (const entry of activity) if (entry.state) this.applyState(entry.state);
  }

  markInterrupted(ids: readonly string[], resumed: readonly string[]): void {
    const again = new Set(resumed);
    for (const id of ids) this.#patch(id, { interrupted: !again.has(id) });
  }

  apply(event: AgentEvent): void {
    if (event.type === "worker.event") {
      const child = event.event;
      if (child.type === "session.state")
        this.#workers = {
          ...this.#workers,
          [event.sessionId]: {
            running: child.state.running,
            approvals: child.state.approvals.length,
            jobs: child.state.jobs.filter((job) => job.status === "running").length,
            interrupted: child.state.interrupted,
          },
        };
      else if (child.type === "run.interrupted")
        this.#workers = { ...this.#workers, [event.sessionId]: { ...IDLE, interrupted: true } };
    }
    if (event.type === "session.state") this.applyState(event.state);
  }

  applyState(input: SessionState): void {
    const incoming = SessionStateSchema.parse(input);
    const current = this.#states.get(incoming.sessionId) ?? null;
    const retired = this.#retiredEpochs.get(incoming.sessionId) ?? new Set<string>();
    const state = newerSessionState(current, incoming, retired) ? incoming : (current ?? incoming);
    if (current && current.epoch !== state.epoch) retired.add(current.epoch);
    this.#retiredEpochs.set(state.sessionId, retired);
    this.#states.set(state.sessionId, state);
    this.#patch(state.sessionId, {
      running: state.running,
      interrupted: state.interrupted,
      approvals: state.approvals.length,
      jobs: state.jobs.filter((job) => job.status === "running").length,
    });
  }

  forget(sessionId: string): void {
    const { [sessionId]: _worker, ...workers } = this.#workers;
    this.#workers = workers;
    this.#states.delete(sessionId);
    this.#retiredEpochs.delete(sessionId);
    const { [sessionId]: _gone, ...rest } = this.tasks;
    this.tasks = rest;
  }

  #patch(sessionId: string, patch: Partial<TaskState>): void {
    this.tasks = { ...this.tasks, [sessionId]: { ...(this.tasks[sessionId] ?? IDLE), ...patch } };
  }
}
