import {
  type MarketplaceAction,
  type MarketplaceEntry,
  type MarketplaceState,
  MarketplaceStateSchema,
} from "../../../../shared/module-marketplace";
import { type ModuleChange, type ModuleState, ModuleStateSchema } from "../../../../shared/modules";
import { requestAgent } from "../desktop";
import { t } from "../i18n.svelte";
import { settings } from "../settings.svelte";

export class ModulesSettingsStore {
  snapshot = $state<ModuleState>({
    revision: 0,
    modules: [],
    active: [],
    surfaces: [],
    interfaces: [],
    errors: [],
  });
  catalog = $state<MarketplaceState>({ sources: [], entries: [], errors: [] });
  tab = $state<"marketplace" | "installed">("marketplace");
  source = $state("");
  catalogUrl = $state("");
  query = $state("");
  category = $state("all");
  selected = $state<MarketplaceEntry | null>(null);
  busy = $state(false);
  loading = $state(true);
  error = $state("");
  notice = $state("");

  get locked(): boolean {
    return this.busy || settings.dirty;
  }
  get filtered(): MarketplaceEntry[] {
    const query = this.query.trim().toLocaleLowerCase();
    return this.catalog.entries.filter(
      (entry) =>
        (this.category === "all" || entry.category === this.category) &&
        [entry.title, entry.name, entry.description, entry.publisher, ...entry.capabilities]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query),
    );
  }
  installed(entry: MarketplaceEntry) {
    return this.snapshot.modules.find((module) => module.name === entry.name);
  }

  async load(): Promise<void> {
    this.loading = true;
    await this.marketplace({ action: "list" });
    this.loading = false;
  }
  async refreshInstalled(): Promise<void> {
    if (this.busy) return;
    try {
      const response = await requestAgent({ type: "modules.list" });
      if (!response.ok) throw new Error(response.error ?? t("Could not load modules"));
      this.snapshot = ModuleStateSchema.parse(response.moduleState);
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  async marketplace(input: MarketplaceAction): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.notice = "";
    try {
      const response = await requestAgent({ type: "modules.marketplace", ...input }, 180_000);
      if (!response.ok)
        throw new Error(
          response.error ?? t("Could not load marketplace. Try refreshing the catalog."),
        );
      this.catalog = MarketplaceStateSchema.parse(response.moduleMarketplace);
      this.snapshot = ModuleStateSchema.parse(response.moduleState);
      if (input.action !== "list") await settings.load();
      if (input.action === "install")
        this.notice = t("Installed. Review and trust each new module in Installed to enable it.");
      if (input.action === "addSource") this.catalogUrl = "";
      if (input.action === "list" && input.refresh) this.selected = null;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      this.busy = false;
    }
  }
  async change(input: ModuleChange): Promise<void> {
    if (this.locked) return;
    this.busy = true;
    this.error = "";
    this.notice = "";
    try {
      const response = await requestAgent({ type: "modules.change", ...input }, 60_000);
      if (!response.ok) throw new Error(response.error ?? t("Could not update module"));
      this.snapshot = ModuleStateSchema.parse(response.moduleState);
      await settings.load();
      if (input.operation === "install") this.source = "";
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      this.busy = false;
    }
  }
}
