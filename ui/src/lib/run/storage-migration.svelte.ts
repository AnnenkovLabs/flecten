import {
  type StorageMigrationState,
  StorageMigrationStateSchema,
} from "../../../../shared/storage-migration";
import type { AgentEvent } from "../agent-protocol";
import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";

/** A completed migration remains modal until the actual runtime announces readiness. */
export class StorageMigration {
  snapshot = $state<StorageMigrationState | null>(null);
  #ready = false;
  #generation = 0;

  apply(value: unknown): void {
    const parsed = StorageMigrationStateSchema.safeParse(value);
    if (!parsed.success) throw new Error(t("The core returned an invalid response."));
    this.snapshot = parsed.data;
  }

  waitForRuntime(): void {
    this.#ready = false;
    this.#generation += 1;
  }

  interrupted(): void {
    this.waitForRuntime();
    if (this.snapshot)
      this.snapshot = {
        ...this.snapshot,
        phase: "failed",
        error: t("The core stopped. Retry to resume the migration."),
      };
  }

  runtimeReady(): boolean {
    const first = !this.#ready;
    this.#ready = true;
    this.#generation += 1;
    this.snapshot = null;
    return first;
  }

  start = (): Promise<void> => this.#request("storage.migrate");
  accept = (): Promise<void> => this.#request("storage.accept");

  async #request(type: "storage.migrate" | "storage.accept"): Promise<void> {
    const generation = this.#generation;
    const response = await requestAgent({ type });
    if (generation === this.#generation && response.migration) this.apply(response.migration);
  }

  handle(event: Extract<AgentEvent, { type: "storage.migration" }>): void {
    this.apply(event.migration);
  }
}
