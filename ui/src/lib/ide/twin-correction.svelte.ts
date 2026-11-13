import { TwinSnapshotSchema, TwinTeachSchema } from "../../../../shared/twin";
import { requestAgent } from "../desktop";

export interface SavedCorrection {
  id: number;
  path: string;
  before: string;
  after: string;
}

/** Explicit lessons from the most recent save. Saving alone never calls a model. */
export class IdeTwinCorrection {
  pending = $state<SavedCorrection | null>(null);
  busy = $state(false);
  error = $state("");
  taughtPath = $state("");
  #generation = 0;
  #sequence = 0;

  capture(path: string, before: string, after: string): void {
    if (before === after) return;
    // ponytail: keep the latest save only; add a per-file lesson queue if parallel edits need it.
    this.pending = { id: ++this.#sequence, path, before, after };
    this.taughtPath = "";
    this.error = "";
  }

  dismiss(id: number): void {
    if (this.pending?.id === id && !this.busy) this.pending = null;
    this.error = "";
  }

  async teach(id: number, content: string, appliesWhen: string): Promise<boolean> {
    const correction = this.pending;
    if (!correction || correction.id !== id || this.busy) return false;
    const generation = this.#generation;
    const rule = content.trim();
    const input = TwinTeachSchema.safeParse({
      summary: rule.slice(0, 300),
      content: rule,
      appliesWhen: appliesWhen.trim(),
      path: correction.path,
      // The whole edit stays local; only small examples enter the lesson request.
      ...correctionExamples(correction.before, correction.after),
    });
    if (!input.success) return false;
    this.busy = true;
    this.error = "";
    try {
      const { summary, content, appliesWhen } = input.data;
      const response = await requestAgent({
        type: "twin.teach",
        summary,
        content,
        appliesWhen,
        path: correction.path,
        ...correctionExamples(correction.before, correction.after),
      });
      TwinSnapshotSchema.parse(response.twin);
      if (generation !== this.#generation) return false;
      if (this.pending?.id === id) this.pending = null;
      this.taughtPath = correction.path;
      return true;
    } catch (cause) {
      if (generation === this.#generation)
        this.error = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }

  reset(): void {
    this.#generation += 1;
    this.pending = null;
    this.busy = false;
    this.error = "";
    this.taughtPath = "";
  }
}

export function correctionExamples(
  before: string,
  after: string,
): { before: string; after: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++;
  const from = Math.max(0, start - 120);
  return {
    before: before.slice(from, Math.min(before.length, before.length - end + 120)).slice(0, 2000),
    after: after.slice(from, Math.min(after.length, after.length - end + 120)).slice(0, 2000),
  };
}
