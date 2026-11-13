import type { AgentEvent } from "../agent-protocol";
import { requestAgent } from "../desktop";
import { countLabel } from "../format";
import { t } from "../i18n.svelte";
import { toast } from "../toast.svelte";
import type { AgentCheckpoint, AgentRestoreResult } from "../types";

type Response = Extract<AgentEvent, { type: "response" }>;

/** A restore that left files alone; the dialog asks whether to overwrite or include them. */
export interface RestorePrompt {
  id: string;
  target: "before" | "after";
  label: string;
  conflicts: string[];
  protectedPaths: string[];
}

export interface CheckpointHost {
  /** The task on screen: undo takes its latest checkpoint, not one of another task. */
  sessionId(): string | null;
  onRestored(): void;
}

function files(count: number): string {
  return `${countLabel(count, "file")}`;
}

/** What a restore did, in one line. */
export function restoreMessage(result: AgentRestoreResult): string {
  const changed = result.restored.length + result.removed.length;
  const verb = result.target === "before" ? t("Undone") : t("Restored");
  if (changed === 0 && result.skipped.length === 0) return t("Files are already in this state");
  const skipped =
    result.skipped.length > 0 ? t(", skipped: {0}", [files(result.skipped.length)]) : "";
  return `${verb}: ${files(changed)}${skipped}`;
}

/** Undo, redo and restore of checkpoints, with an explicit choice for skipped files. */
export class Checkpoints {
  list = $state<AgentCheckpoint[]>([]);
  prompt = $state<RestorePrompt | null>(null);
  readonly #host: CheckpointHost;
  #lastUndoId: string | null = null;

  constructor(host: CheckpointHost) {
    this.#host = host;
  }

  reset(): void {
    this.list = [];
    this.prompt = null;
    this.#lastUndoId = null;
  }

  async refresh(): Promise<void> {
    try {
      const response = await requestAgent<Response>({ type: "checkpoint.list" }, 15_000);
      this.list = response.checkpoints ?? [];
    } catch {
      this.list = [];
    }
  }

  async restore(
    id: string,
    target: "before" | "after",
    options: { force?: boolean; includeProtected?: boolean; paths?: string[] } = {},
  ): Promise<void> {
    try {
      const response = await requestAgent<Response>(
        { type: "checkpoint.restore", id, target, ...options },
        60_000,
      );
      const result = response.restore;
      this.#lastUndoId = target === "before" ? id : null;
      if (result) this.#report(result);
      else toast.show(target === "before" ? t("Changes undone") : t("Changes restored"));
      await this.refresh();
      this.#host.onRestored();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  dismiss(): void {
    this.prompt = null;
  }

  /** The dialog answer: overwrite files changed later and, if asked, settings and secrets. */
  async resolve(choice: { overwrite: boolean; includeProtected: boolean }): Promise<void> {
    const prompt = this.prompt;
    this.prompt = null;
    if (!prompt) return;
    const paths = [
      ...(choice.overwrite ? prompt.conflicts : []),
      ...(choice.includeProtected ? prompt.protectedPaths : []),
    ];
    if (paths.length === 0) return;
    await this.restore(prompt.id, prompt.target, {
      paths,
      ...(choice.overwrite ? { force: true } : {}),
      ...(choice.includeProtected ? { includeProtected: true } : {}),
    });
  }

  async undo(): Promise<void> {
    if (this.list.length === 0) await this.refresh();
    const sessionId = this.#host.sessionId();
    const checkpoint = this.list.find(
      (entry) => entry.finalizedAt && (sessionId === null || entry.sessionId === sessionId),
    );
    if (!checkpoint) {
      toast.show(t("Nothing to undo"));
      return;
    }
    await this.restore(checkpoint.id, "before");
  }

  async redo(): Promise<void> {
    if (!this.#lastUndoId) {
      toast.show(t("Nothing to retry"));
      return;
    }
    await this.restore(this.#lastUndoId, "after");
  }

  #report(result: AgentRestoreResult): void {
    toast.show(restoreMessage(result));
    const conflicts = result.skipped
      .filter((skip) => skip.reason === "conflict")
      .map((skip) => skip.path);
    const protectedPaths = result.skipped
      .filter((skip) => skip.reason === "protected")
      .map((skip) => skip.path);
    if (conflicts.length === 0 && protectedPaths.length === 0) return;
    const checkpoint = this.list.find((entry) => entry.id === result.id);
    this.prompt = {
      id: result.id,
      target: result.target,
      label: checkpoint?.command ?? checkpoint?.label ?? result.id,
      conflicts,
      protectedPaths,
    };
  }
}
