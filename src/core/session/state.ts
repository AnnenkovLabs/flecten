import {
  type SessionPhase,
  type SessionState,
  SessionStateSchema,
} from "../../../shared/session-state";
import { jobView } from "../../tools/jobs/view";
import type { Event } from "../types";
import type { SessionRuntime } from "./runtime";

export function phaseFromEvent(event: Event, previous: SessionPhase): SessionPhase {
  switch (event.type) {
    case "session.started":
    case "turn.started":
    case "tool.started":
    case "message.reset":
      return "running";
    case "message.delta":
      return "writing";
    case "message.finished":
      return event.toolCalls.length > 0 ? "running" : previous;
    case "run.interrupted":
      return "stopped";
    case "session.finished":
      switch (event.result.stopReason) {
        case "stopped":
        case "budget":
          return "stopped";
        case "error":
        case "max_turns":
          return "failed";
        default:
          return "idle";
      }
    case "error":
      return event.code === "run_failed" ? "failed" : previous;
    default:
      return previous;
  }
}

/** Phase belongs to the core; mutable collections are read from their existing owners. */
export class SessionStatePublisher {
  readonly #epoch = crypto.randomUUID();
  #revision = 0;
  #phase: SessionPhase;
  #last = "";
  #published = 0;
  #interrupted: boolean;
  constructor(phase: SessionPhase = "idle", interrupted = false) {
    this.#phase = phase;
    this.#interrupted = interrupted;
  }

  starting(): void {
    this.#phase = "running";
  }

  failed(): void {
    this.#phase = "failed";
  }

  note(event: Event): boolean {
    const previous = this.#phase;
    this.#phase = phaseFromEvent(event, this.#phase);
    if (event.type === "session.started") this.#interrupted = false;
    else if (event.type === "run.interrupted") this.#interrupted = true;
    return (
      previous !== this.#phase ||
      event.type === "session.started" ||
      event.type === "session.finished" ||
      event.type === "turn.started" ||
      event.type === "approval.requested" ||
      event.type === "approval.resolved" ||
      event.type === "job.started" ||
      event.type === "job.finished" ||
      event.type === "steer.applied"
    );
  }

  snapshot(runtime: SessionRuntime): SessionState | undefined {
    const sessionId = runtime.sessionId();
    if (!sessionId) return undefined;
    const state = SessionStateSchema.parse({
      sessionId,
      epoch: this.#epoch,
      revision: this.#revision,
      phase: this.#phase,
      running: runtime.busy(),
      stopRequested: runtime.active()?.stop.signal.aborted ?? false,
      interrupted: this.#interrupted,
      turns: runtime.active()?.turns ?? 0,
      queue: runtime.queue.list().filter((item) => item.state === "pending"),
      approvals: runtime.approvals.pending(),
      approvalResolutions: runtime.approvals.resolutions(),
      jobs: runtime.terminals.listJobs().map((job) => jobView(job.snapshot())),
    });
    // Job duration changes on read, not state; structural job events publish its current value.
    const fingerprint = JSON.stringify({
      ...state,
      revision: 0,
      jobs: state.jobs.map(({ durationMs: _, ...job }) => job),
    });
    if (fingerprint !== this.#last) {
      this.#revision += 1;
      this.#last = fingerprint;
    }
    return { ...state, revision: this.#revision };
  }

  publish(runtime: SessionRuntime): void {
    const state = this.snapshot(runtime);
    if (state && this.#revision !== this.#published) {
      this.#published = this.#revision;
      runtime.emit({ type: "session.state", sessionId: state.sessionId, state });
    }
  }
}
