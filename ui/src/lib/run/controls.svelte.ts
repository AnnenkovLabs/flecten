import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";
import { errorMessage } from "../run-errors";
import { toast } from "../toast.svelte";
import type { TaskView } from "./view.svelte";

export const RUN_CONTROL_COOLDOWN_MS = 650;

/** Shared by both composers and notice actions, including keyboard shortcuts. */
export class RunControls {
  coolingDown = $state(false);
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly view: TaskView,
    private readonly sessionId: () => string | null,
    private readonly connected: () => boolean,
    private readonly resume: () => boolean,
  ) {}

  get canContinue(): boolean {
    return this.sessionId() !== null && this.connected() && this.view.resumable;
  }

  continue(): boolean {
    if (this.coolingDown || !this.canContinue) return false;
    this.#cooldown();
    return this.resume();
  }

  stop(): void {
    const sessionId = this.sessionId();
    if (this.coolingDown || !this.view.busy || !sessionId) return;
    const generation = this.view.generation;
    this.#cooldown();
    requestAgent({ type: "stop", sessionId, mode: this.view.stopping ? "force" : "graceful" })
      .then((response) => {
        if (sessionId === this.sessionId() && generation === this.view.generation)
          this.view.attach(response.state);
      })
      .catch((error: unknown) => toast.error(t("Could not stop: {0}", [errorMessage(error)])));
  }

  dispose(): void {
    clearTimeout(this.#timer);
    this.coolingDown = false;
  }

  #cooldown(): void {
    clearTimeout(this.#timer);
    this.coolingDown = true;
    this.#timer = setTimeout(() => {
      this.coolingDown = false;
    }, RUN_CONTROL_COOLDOWN_MS);
  }
}
