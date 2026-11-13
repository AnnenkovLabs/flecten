import type { TerminalManager, TerminalManagerEvent } from "../../terminal/manager";
import { jobLine, jobView, tail } from "../../tools/jobs/view";
import { markdownValue } from "../../util/markdown";
import { wrapUntrusted } from "../loop/tool-message";
import type { SteeringMessage } from "../loop/types";
import type { Event, SessionId } from "../types";

const NOTICE_TAIL_LINES = 12;

function noticeText(event: Extract<TerminalManagerEvent, { type: "job.completed" }>): string {
  const view = jobView(event.job);
  return [
    "# Background job notice",
    "",
    `- Job identifier: ${markdownValue(view.id)}`,
    `- Status: ${markdownValue(view.status)}`,
    ...(view.exitCode === null ? [] : [`- Exit code: ${markdownValue(view.exitCode)}`]),
    "",
    `Background job finished: ${jobLine(view)}`,
    wrapUntrusted(tail(event.job.log, NOTICE_TAIL_LINES), {
      source: "shell",
      ref: `job ${view.id}`,
    }),
    `Full log tool: ${markdownValue("jobs")}. Operation: ${markdownValue("output")}. Job identifier: ${markdownValue(view.id)}.`,
  ].join("\n");
}

/**
 * Turns background job events of a session into thread events and model notices. A notice
 * reaches the model of the task that started the job: at the next turn boundary while it
 * runs, or at the start of its next run when it is idle. Another task on the same handle
 * never sees it, and a finished build is never silently lost.
 */
export class JobNotices {
  readonly #pending = new Map<SessionId, SteeringMessage[]>();
  readonly #owners = new Map<string, SessionId>();
  readonly #unsubscribe: () => void;

  constructor(
    terminals: TerminalManager,
    emit: (event: Event) => void,
    sessionId: () => SessionId | undefined,
  ) {
    this.#unsubscribe = terminals.onEvent((event) => {
      if (event.type === "job.started") {
        const owner = sessionId();
        if (owner === undefined) return;
        this.#owners.set(event.job.id, owner);
        emit({ type: "job.started", sessionId: owner, job: jobView(event.job) });
        return;
      }
      const owner = this.#owners.get(event.job.id) ?? sessionId();
      if (owner === undefined) return;
      this.#owners.delete(event.job.id);
      const checkpoint = event.extra?.checkpoint;
      emit({
        type: "job.finished",
        sessionId: owner,
        job: jobView(event.job),
        notify: event.notify,
        ...(checkpoint === undefined ? {} : { checkpoint }),
      });
      const pending = this.#pending.get(owner) ?? [];
      pending.push({ text: noticeText(event), kind: "notice" });
      this.#pending.set(owner, pending);
    });
  }

  /** Notices for this task's jobs; other tasks' notices wait for their own runs. */
  take(sessionId: SessionId | undefined): SteeringMessage[] {
    if (sessionId === undefined) return [];
    const pending = this.#pending.get(sessionId) ?? [];
    this.#pending.delete(sessionId);
    return pending;
  }

  dispose(): void {
    this.#unsubscribe();
  }
}
