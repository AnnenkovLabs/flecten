import { type ModuleState, ModuleStateSchema } from "../../../../shared/modules";
import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";

export class ModuleStore {
  state = $state<ModuleState>({
    revision: 0,
    modules: [],
    active: [],
    surfaces: [],
    interfaces: [],
    errors: [],
  });
  error = $state("");
  #ticket = 0;
  #refreshing = false;
  constructor(readonly session: () => string | null) {}
  watch(ready: () => boolean): () => void {
    const timer = setInterval(() => {
      if (ready()) void this.refresh();
    }, 2000);
    return () => clearInterval(timer);
  }

  async refresh(): Promise<void> {
    if (this.#refreshing) return;
    this.#refreshing = true;
    const sessionId = this.session();
    const ticket = this.#ticket;
    try {
      const response = await requestAgent(
        { type: "modules.list", ...(sessionId ? { sessionId } : {}) },
        15_000,
      );
      if (ticket !== this.#ticket || sessionId !== this.session()) return;
      if (!response.ok) throw new Error(response.error ?? t("Could not load modules"));
      const next = ModuleStateSchema.parse(response.moduleState);
      if (JSON.stringify(next) !== JSON.stringify(this.state)) this.state = next;
      this.error = "";
    } catch (error) {
      if (ticket === this.#ticket)
        this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.#refreshing = false;
    }
  }
  reset(): void {
    this.#ticket++;
    this.state = {
      ...this.state,
      active: [],
      surfaces: this.state.surfaces.filter((s) => s.placement),
      errors: [],
    };
    this.error = "";
  }
}
