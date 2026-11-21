import type { ModelChoice } from "../../../shared/model-choice";
import {
  type TwinCandidate,
  type TwinSnapshot,
  TwinSnapshotSchema,
  type TwinSourceId,
} from "../../../shared/twin";
import { requestAgent } from "./desktop";
import {
  TWIN_FALLING_MS,
  TWIN_PLEADING_MS,
  TWIN_REVIVING_MS,
  type TwinPowerPhase,
  type TwinPowerVisual,
} from "./twin/power";

/** One project-scoped projection. Only the sidecar reads history or calls a model. */
export class TwinStore {
  projectEpoch = $state(0);
  snapshot = $state<TwinSnapshot | null>(null);
  busy = $state(false);
  error = $state("");
  selected = $state<TwinSourceId[]>([]);
  tab = $state<"sources" | "profile">("sources");
  editing = $state<TwinCandidate | null>(null);
  power = $state<TwinPowerVisual>({ phase: "disabled", since: 0 });
  configuring = $state(false);
  dismissedError = $state("");
  #desiredEnabled = $state<boolean>();
  #generation = 0;
  #pollFailed = false;
  #poll: ReturnType<typeof setTimeout> | undefined;
  #powerTimer: ReturnType<typeof setTimeout> | undefined;

  get training(): boolean {
    return (
      this.snapshot?.training.state === "reading" || this.snapshot?.training.state === "learning"
    );
  }

  get enabled(): boolean {
    return this.#desiredEnabled ?? this.snapshot?.enabled ?? false;
  }

  reset(): void {
    this.projectEpoch += 1;
    this.#generation += 1;
    clearTimeout(this.#poll);
    clearTimeout(this.#powerTimer);
    this.power = { phase: "disabled", since: 0 };
    this.#desiredEnabled = undefined;
    this.configuring = false;
    this.snapshot = null;
    this.busy = false;
    this.error = "";
    this.dismissedError = "";
    this.selected = [];
    this.editing = null;
    this.tab = "sources";
  }

  dismissTransientErrors(): void {
    this.error = "";
    if (this.snapshot?.training.state === "error") {
      this.dismissedError = this.snapshot.training.message;
    }
  }

  dispose(): void {
    this.#generation += 1;
    clearTimeout(this.#poll);
    clearTimeout(this.#powerTimer);
    this.#desiredEnabled = undefined;
    this.configuring = false;
  }

  async load(scan = false): Promise<void> {
    if (this.busy) return;
    const selection = this.snapshot ? [...this.selected] : undefined;
    const loaded = await this.#request({ type: scan ? "twin.scan" : "twin.get" });
    if (loaded)
      this.selected =
        this.snapshot?.sources
          .filter((source) => (selection ? selection.includes(source.id) : source.selected))
          .map((source) => source.id) ?? [];
  }

  toggleSource(id: TwinSourceId, checked: boolean): void {
    this.selected = checked
      ? [...new Set([...this.selected, id])]
      : this.selected.filter((value) => value !== id);
  }

  async setTrainingModel(choice: ModelChoice | null): Promise<void> {
    if (this.busy || this.training) return;
    await this.#request({ type: "twin.configure", trainingModel: choice });
  }

  async train(): Promise<void> {
    if (this.busy || this.training || !this.selected.length) return;
    this.dismissedError = "";
    await this.#request({
      type: "twin.train",
      sourceIds: this.selected,
      ...(this.snapshot?.trainingModel ? { trainingModel: this.snapshot.trainingModel } : {}),
    });
  }

  async cancel(): Promise<void> {
    if (this.busy || !this.training) return;
    await this.#request({ type: "twin.cancel" });
  }

  async configure(enabled: boolean): Promise<void> {
    if (!this.snapshot || (this.busy && !this.configuring) || enabled === this.enabled) return;
    this.#desiredEnabled = enabled;
    this.#setPower(enabled ? "reviving" : "pleading");
    if (this.configuring) return;
    this.configuring = true;
    const projectEpoch = this.projectEpoch;
    while (this.#desiredEnabled !== undefined) {
      const desired: boolean = this.#desiredEnabled;
      const generation = this.#generation + 1;
      const saved = await this.#request({ type: "twin.configure", enabled: desired });
      if (projectEpoch !== this.projectEpoch || generation !== this.#generation) return;
      if (!saved) {
        this.#desiredEnabled = undefined;
        this.#setPower(this.snapshot?.enabled ? "enabled" : "disabled");
        break;
      }
      if (this.#desiredEnabled === desired) this.#desiredEnabled = undefined;
    }
    this.configuring = false;
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

  async #request(command: Parameters<typeof requestAgent>[0], poll = false): Promise<boolean> {
    if (!poll) {
      // A foreground action supersedes every older background snapshot, including errors.
      this.#generation += 1;
      clearTimeout(this.#poll);
      this.busy = true;
      this.error = "";
      this.#pollFailed = false;
    }
    const generation = this.#generation;
    try {
      const response = await requestAgent(command, 120_000);
      const snapshot = TwinSnapshotSchema.parse(response.twin);
      if (generation !== this.#generation) return false;
      if (this.#pollFailed) this.error = "";
      this.#pollFailed = false;
      const previousEnabled = this.snapshot?.enabled;
      if (
        command.type !== "twin.configure" &&
        (previousEnabled === undefined || previousEnabled !== snapshot.enabled)
      )
        this.#setPower(snapshot.enabled ? "enabled" : "disabled");
      this.snapshot = snapshot;
      return true;
    } catch (cause) {
      if (generation === this.#generation) {
        this.error = cause instanceof Error ? cause.message : String(cause);
        this.#pollFailed = poll;
      }
      return false;
    } finally {
      if (generation === this.#generation) {
        if (!poll) this.busy = false;
        this.#schedule();
      }
    }
  }

  #schedule(): void {
    clearTimeout(this.#poll);
    if (this.training)
      this.#poll = setTimeout(() => {
        void this.#request({ type: "twin.get" }, true);
      }, 1000);
  }

  #setPower(phase: TwinPowerPhase, since = performance.now()): void {
    clearTimeout(this.#powerTimer);
    this.power = { phase, since };
    const next = {
      pleading: { phase: "falling", duration: TWIN_PLEADING_MS },
      falling: { phase: "disabled", duration: TWIN_FALLING_MS },
      reviving: { phase: "enabled", duration: TWIN_REVIVING_MS },
    } as const;
    if (phase === "enabled" || phase === "disabled") return;
    const transition = next[phase];
    const deadline = since + transition.duration;
    this.#powerTimer = setTimeout(
      () => this.#setPower(transition.phase, deadline),
      Math.max(0, deadline - performance.now()),
    );
  }
}
