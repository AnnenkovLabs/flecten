import {
  type TwinAnswer,
  TwinAnswerSchema,
  type TwinCandidate,
  type TwinSnapshot,
  TwinSnapshotSchema,
  type TwinSourceId,
} from "../../../shared/twin";
import { requestAgent } from "./desktop";

/** One project-scoped projection. Only the sidecar reads history or calls a model. */
export class TwinStore {
  snapshot = $state<TwinSnapshot | null>(null);
  busy = $state(false);
  error = $state("");
  answer = $state<TwinAnswer | null>(null);
  question = $state("");
  selected = $state<TwinSourceId[]>([]);
  tab = $state<"sources" | "profile" | "ask">("sources");
  editing = $state<TwinCandidate | null>(null);
  #generation = 0;
  #poll: ReturnType<typeof setTimeout> | undefined;

  get training(): boolean {
    return (
      this.snapshot?.training.state === "reading" || this.snapshot?.training.state === "learning"
    );
  }

  reset(): void {
    this.#generation += 1;
    clearTimeout(this.#poll);
    this.snapshot = null;
    this.busy = false;
    this.error = "";
    this.answer = null;
    this.question = "";
    this.selected = [];
    this.editing = null;
  }

  dispose(): void {
    this.#generation += 1;
    clearTimeout(this.#poll);
  }

  async load(scan = false): Promise<void> {
    if (this.busy) return;
    const loaded = await this.#request({ type: scan ? "twin.scan" : "twin.get" });
    if (loaded)
      this.selected =
        this.snapshot?.sources.filter((source) => source.selected).map((source) => source.id) ?? [];
  }

  toggleSource(id: TwinSourceId, checked: boolean): void {
    this.selected = checked
      ? [...new Set([...this.selected, id])]
      : this.selected.filter((value) => value !== id);
  }

  async train(): Promise<void> {
    if (this.busy || this.training) return;
    await this.#request({ type: "twin.train", sourceIds: this.selected });
  }

  async cancel(): Promise<void> {
    await this.#request({ type: "twin.cancel" });
  }

  async configure(enabled: boolean): Promise<void> {
    if (this.busy) return;
    await this.#request({ type: "twin.configure", enabled });
  }

  async review(
    candidate: TwinCandidate,
    action: "accept" | "reject",
    edited = false,
  ): Promise<void> {
    if (this.busy) return;
    if (
      await this.#request({
        type: "twin.review",
        candidateId: candidate.id,
        action,
        ...(edited
          ? {
              edits: {
                summary: candidate.summary,
                content: candidate.content,
                appliesWhen: candidate.appliesWhen,
                reaction: candidate.reaction,
                strength: candidate.strength,
                voice: candidate.voice,
              },
            }
          : {}),
      })
    )
      this.editing = null;
  }

  async forget(id: string, expectedRevision: number): Promise<void> {
    if (!this.busy) await this.#request({ type: "twin.forget", id, expectedRevision });
  }

  async update(entry: TwinSnapshot["entries"][number]): Promise<void> {
    if (this.busy) return;
    if (
      await this.#request({
        type: "twin.update",
        id: entry.id,
        expectedRevision: entry.revision,
        edits: {
          summary: entry.summary,
          content: entry.content,
          appliesWhen: entry.appliesWhen,
          reaction: entry.reaction,
          strength: entry.strength,
          voice: entry.voice,
        },
      })
    )
      this.editing = null;
  }

  async consult(): Promise<void> {
    if (this.busy || !this.question.trim()) return;
    this.answer = null;
    await this.#request({ type: "twin.consult", question: this.question });
  }

  async #request(command: Parameters<typeof requestAgent>[0], poll = false): Promise<boolean> {
    const generation = this.#generation;
    if (!poll) {
      this.busy = true;
      this.error = "";
    }
    try {
      const response = await requestAgent(command, 120_000);
      const snapshot = TwinSnapshotSchema.parse(response.twin);
      const answer =
        response.answer === undefined ? undefined : TwinAnswerSchema.parse(response.answer);
      if (generation !== this.#generation) return false;
      this.snapshot = snapshot;
      if (answer) this.answer = answer;
      this.#schedule();
      return true;
    } catch (cause) {
      if (generation === this.#generation) {
        this.error = cause instanceof Error ? cause.message : String(cause);
        if (poll) this.#schedule();
      }
      return false;
    } finally {
      if (!poll && generation === this.#generation) this.busy = false;
    }
  }

  #schedule(): void {
    clearTimeout(this.#poll);
    if (this.training)
      this.#poll = setTimeout(() => {
        void this.#request({ type: "twin.get" }, true);
      }, 1000);
  }
}
