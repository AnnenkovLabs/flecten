import { z } from "zod";
import { PageCommandSchema } from "../core/pages/control";
import type { SessionEvent, ToolCall } from "../core/types";
import { RemoteJobSchema, RemoteTargetSchema } from "../tools/jobs/remote-schema";

const remoteResult = z.union([
  z.object({ kind: z.literal("remote_job"), job: RemoteJobSchema }),
  z.object({
    kind: z.literal("remote_job"),
    id: RemoteJobSchema.shape.id,
    state: z.literal("uncertain"),
    remote: RemoteTargetSchema.optional(),
  }),
]);
type RecoveryJob = {
  id: string;
  command?: string;
  status?: string;
  remote?: z.infer<typeof RemoteTargetSchema>;
};

/** Rebuilt from durable Worker events, never from the Talker's narration. */
export class WorkerRecovery {
  #active = new Map<string, ToolCall>();
  #uncertain = new Map<string, ToolCall>();
  #jobs = new Map<string, RecoveryJob>();
  #page: { page?: number; path?: string; objective?: string } | undefined;
  #confirmed: { callId: string; tool: string; outcome: string } | undefined;
  #stop: { kind: string; detail?: string } | undefined;
  #partial: string | undefined;
  #assignment: string | undefined;

  get partial(): string | undefined {
    return this.#partial;
  }

  note(event: SessionEvent): void {
    if (event.type === "worker.acceptance") {
      const revision = `${event.acceptance.taskId}:${event.acceptance.revision}`;
      if (this.#assignment !== revision) {
        this.#partial = undefined;
        this.#confirmed = undefined;
        this.#page = undefined;
        this.#assignment = revision;
      }
    }
    if (event.type === "session.started") this.#stop = undefined;
    if (event.type === "tool.started") this.#active.set(event.call.id, event.call);
    if (event.type === "tool.finished") {
      this.#active.delete(event.call.id);
      this.#uncertain.delete(event.call.id);
      const remote = remoteResult.safeParse(event.result.data);
      if (remote.success) {
        const result = remote.data;
        const job: RecoveryJob =
          "job" in result
            ? {
                id: result.job.id,
                status: result.job.state?.status ?? "uncertain",
                command: result.job.argv.join(" ").slice(0, 1500),
                remote: result.job.target,
              }
            : {
                ...this.#jobs.get(result.id),
                id: result.id,
                status: result.state,
                ...(result.remote ? { remote: result.remote } : {}),
              };
        this.#jobs.set(job.id, job);
      }
      if (event.result.ok)
        this.#confirmed = {
          callId: event.call.id,
          tool: event.call.name,
          outcome: event.result.output.slice(0, 1200),
        };
      if (event.call.name === "context" && event.result.ok) {
        const command = PageCommandSchema.safeParse(event.call.args);
        if (command.success && command.data.op === "begin")
          this.#page = { objective: command.data.objective };
        if (command.success && command.data.op === "complete") {
          const report = command.data;
          if (report.finalResult || report.result)
            this.#partial = report.finalResult || report.result;
        }
      }
    }
    if (event.type === "context.compacted")
      this.#page = {
        ...this.#page,
        ...(event.page === undefined ? {} : { page: event.page }),
        ...(event.path ? { path: event.path } : {}),
      };
    if (event.type === "job.started" || event.type === "job.finished")
      this.#jobs.set(event.job.id, {
        id: event.job.id,
        command: event.job.command,
        status: event.job.status,
      });
    if (event.type === "error")
      this.#stop = { kind: event.code, detail: event.message.slice(0, 1500) };
    if (event.type === "provider.retry")
      this.#stop = { kind: event.kind, detail: event.reason.slice(0, 1500) };
    if (event.type === "session.finished" || event.type === "run.interrupted") {
      if (event.type === "session.finished") {
        if (event.result.stopReason !== "error" || !this.#stop)
          this.#stop = {
            kind: event.result.stopReason,
            detail: event.result.summary.slice(0, 1500),
          };
      } else this.#stop = { kind: "interrupted", detail: event.reason };
      this.interrupted();
    }
  }

  interrupted(): void {
    for (const [id, call] of this.#active) this.#uncertain.set(id, call);
    this.#active.clear();
  }

  markdown(): string {
    return [
      "# Operational recovery state",
      `Stop cause: ${this.#stop?.kind ?? "unknown"}`,
      `Last confirmed step: ${this.#confirmed ? `${this.#confirmed.tool} (${this.#confirmed.callId})` : "none recorded"}`,
      `Page: ${this.#page?.page ?? "unknown"}; archive: ${this.#page?.path ?? "none"}`,
      ...[...this.#uncertain.values()]
        .slice(-16)
        .map(
          (call) =>
            `Uncertain operation: ${call.name}, call ID ${call.id}. Reconcile its effects before repeating it.`,
        ),
      ...[...this.#jobs.values()]
        .slice(-16)
        .map((job) => `Job handle: ${job.id}; state: ${job.status ?? "unknown"}`),
      "Inspect the recorded handles and evidence before retrying an operation. Tool success alone does not prove the task's expected outputs exist.",
    ].join("\n\n");
  }

  view() {
    const calls = (source: Map<string, ToolCall>) =>
      [...source.values()].slice(-16).map((call) => ({
        callId: call.id,
        tool: call.name,
        arguments: JSON.stringify(call.args).slice(0, 1500),
      }));
    return {
      lastConfirmedStep: this.#confirmed,
      page: this.#page,
      activeCalls: calls(this.#active),
      uncertainEffects: calls(this.#uncertain),
      jobs: [...this.#jobs.values()].slice(-16),
      stopCause: this.#stop,
      partialResult: this.#partial,
    };
  }
}
