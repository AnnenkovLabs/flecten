import type { AgentEvent } from "../agent-protocol";
import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";
import { toast } from "../toast.svelte";
import type { ApprovalChoice } from "./intents";
import type { TaskView } from "./view.svelte";

type Response = Extract<AgentEvent, { type: "response" }>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Requests about the task on screen: its queue, approvals, a running call, background jobs
 * and compaction. Each one names the session, so it reaches this task while others run.
 */
export class TaskCommands {
  readonly #view: TaskView;
  readonly #sessionId: () => string | null;

  constructor(view: TaskView, sessionId: () => string | null) {
    this.#view = view;
    this.#sessionId = sessionId;
  }

  async stopWorker(): Promise<void> {
    try {
      await requestAgent({ type: "stop", ...this.#routed(), mode: "force", target: "worker" });
    } catch (error) {
      toast.error(message(error));
    }
  }

  async stopSubagent(id: string): Promise<void> {
    const item = this.#view.subagents.items.find((item) => item.id === id);
    if (item) item.stopping = true;
    try {
      const response = await requestAgent({ type: "subagent.stop", ...this.#routed(), id });
      if (
        item &&
        !(
          response.result &&
          typeof response.result === "object" &&
          "stopped" in response.result &&
          response.result.stopped === true
        )
      )
        item.stopping = false;
    } catch (error) {
      if (item) item.stopping = false;
      toast.error(message(error));
    }
  }

  async editQueued(id: string, text: string): Promise<void> {
    if (text.trim().length === 0) return;
    const current = this.#currentView();
    try {
      const response = await requestAgent(
        { type: "queue.edit", ...this.#routed(), id, text },
        10_000,
      );
      if (current()) this.#view.attach(response.state);
    } catch (error) {
      toast.error(message(error));
    }
  }

  async removeQueued(id: string): Promise<void> {
    const current = this.#currentView();
    try {
      const response = await requestAgent({ type: "queue.remove", ...this.#routed(), id }, 10_000);
      if (current()) this.#view.attach(response.state);
    } catch (error) {
      toast.error(message(error));
    }
  }

  async respondApproval(
    sessionId: string,
    id: string,
    choice: ApprovalChoice,
    feedback?: string,
  ): Promise<void> {
    const current = this.#currentView();
    const item = this.#view.thread.items.find(
      (entry) => entry.kind === "approval" && entry.approval.id === id,
    );
    if (item?.kind !== "approval" || item.resolving || item.state !== "pending") return;
    item.resolving = true;
    item.error = "";
    try {
      const response = await requestAgent(
        {
          type: "approval.respond",
          sessionId,
          id,
          decision: choice,
          ...(feedback !== undefined ? { feedback } : {}),
        },
        10_000,
      );
      if (sessionId !== this.#sessionId() || !current()) return;
      if (response.approval && item.state === "pending")
        this.#view.thread.resolveApproval(response.approval.id, response.approval.choice, "user");
      this.#view.attach(response.state);
    } catch (error) {
      item.error = message(error);
      toast.error(message(error));
    } finally {
      item.resolving = false;
    }
  }

  async cancelTool(callId: string): Promise<void> {
    try {
      await requestAgent({ type: "tool.cancel", ...this.#routed(), callId }, 10_000);
    } catch (error) {
      toast.error(message(error));
    }
  }

  async stopJob(id: string): Promise<void> {
    const current = this.#currentView();
    try {
      const response = await requestAgent<Response>(
        { type: "jobs.stop", ...this.#routed(), id },
        15_000,
      );
      if (current() && response.job) this.#view.upsertJob(response.job);
    } catch (error) {
      toast.error(message(error));
    }
  }

  async compact(focus?: string): Promise<void> {
    const current = this.#currentView();
    try {
      const response = await requestAgent<Response>(
        { type: "context.compact", ...this.#routed(), ...(focus ? { focus } : {}) },
        120_000,
      );
      if (!current()) return;
      if (response.context) this.#view.context.apply(response.context);
      if (response.scheduled) toast.show(t("Context will be compacted before the next request"));
      else toast.show(response.compacted ? t("Context compacted") : t("Nothing to compact yet"));
    } catch (error) {
      toast.error(message(error));
    }
  }

  #currentView(): () => boolean {
    const sessionId = this.#sessionId();
    const generation = this.#view.generation;
    return () => sessionId === this.#sessionId() && generation === this.#view.generation;
  }

  #routed(): { sessionId?: string } {
    const sessionId = this.#sessionId();
    return sessionId ? { sessionId } : {};
  }
}
