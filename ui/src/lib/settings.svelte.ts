import { onAgentEvent, requestAgent, sendAgent } from "./desktop";
import { modelsCount } from "./format";
import { t } from "./i18n.svelte";
import { formatModelName } from "./model-name";
import type { ApprovalDecision, ApprovalView } from "./permissions";
import { applyPreferences } from "./preferences.svelte";
import { answerAllApprovals, approvalViews, respondApproval } from "./settings/approvals";
import { actualizeProvider, probeKey, probeModel, testProvider } from "./settings/provider-checks";
import {
  activateIfNeeded,
  mergeModels,
  providerWithBaseUrl,
  uniqueProviderId,
} from "./settings/provider-draft";
import { settingsIssue } from "./settings/validation";
import {
  cleanSettings,
  clone,
  emptyProvider,
  filterCatalog,
  filterProviders,
  hostName,
  saveBlocker,
  settingsDirty,
} from "./settings-utils";
import type {
  AgentEvent,
  AgentInfo,
  CatalogStatus,
  CatalogSummary,
  DiscoverResult,
  HarnessSettings,
  ModelInfo,
  ProbeResult,
  ProviderActualizeResult,
  ProviderInfo,
  ProviderProtocol,
  ProviderSettings,
  ProviderTestResult,
} from "./types";

type Response = Extract<AgentEvent, { type: "response" }>;

export class SettingsStore {
  open = $state(false);
  loading = $state(false);
  saving = $state(false);
  /** Tasks running now; their next run takes saved settings. */
  runningTasks = $state(0);
  #running = new Set<string>();
  error = $state("");
  notice = $state("");
  settings = $state<HarnessSettings | null>(null);
  baseline = $state<HarnessSettings | null>(null);
  info = $state<AgentInfo | null>(null);
  catalog = $state<CatalogSummary[]>([]);
  catalogLoading = $state(false);
  selected = $state<string | null>(null);
  search = $state("");
  requestedSection = $state<import("./settings/sections").SettingsSectionId | null>(null);
  providerSearch = $state("");
  addOpen = $state(false);
  addMode = $state<"ready" | "custom">("ready");
  catalogSearch = $state("");
  discovering = $state(false);
  discoverResult = $state<DiscoverResult | null>(null);
  testing = $state(false);
  testResult = $state<ProviderTestResult | null>(null);
  probeResults = $state<Record<string, ProbeResult | "loading">>({});
  catalogStatus = $state<CatalogStatus | null>(null);
  syncing = $state(false);
  actualizing = $state(false);
  actualizeResult = $state<ProviderActualizeResult | null>(null);
  clearApiKeys = $state<string[]>([]);
  custom = $state({
    protocol: "openai-chat" as ProviderProtocol,
    baseUrl: "",
    apiKey: "",
  });

  #returnFocus: HTMLElement | null = null;
  get dirty(): boolean {
    return settingsDirty(this.settings, this.baseline);
  }

  get approvals(): ApprovalView[] {
    return approvalViews(this.info);
  }

  respondApproval(id: string, decision: ApprovalDecision, feedback?: string): Promise<void> {
    return respondApproval(this, id, decision, feedback);
  }

  allowAllApprovals(ids?: string[]): Promise<void> {
    return answerAllApprovals(this, "approval.allowAll", ids);
  }

  denyAllApprovals(ids?: string[]): Promise<void> {
    return answerAllApprovals(this, "approval.denyAll", ids);
  }

  get validationIssue(): string {
    const config = this.settings;
    if (!config) return "";
    return settingsIssue(config);
  }

  get canSave(): boolean {
    return (
      Boolean(this.settings) &&
      this.dirty &&
      !this.saving &&
      !this.loading &&
      this.validationIssue === ""
    );
  }

  get provider(): ProviderSettings | null {
    return this.settings && this.selected ? (this.settings.providers[this.selected] ?? null) : null;
  }

  get selectedInfo(): ProviderInfo | undefined {
    return this.info?.providers.find((entry) => entry.id === this.selected);
  }

  get models(): Array<{ id: string; model: ModelInfo }> {
    const provider = this.provider;
    if (!provider) return [];
    return Object.entries(provider.models).map(([id, model]) => ({ id, model }));
  }

  get filteredProviders(): Array<{ id: string; provider: ProviderSettings; active: boolean }> {
    return this.settings ? filterProviders(this.settings, this.providerSearch) : [];
  }

  get filteredCatalog(): CatalogSummary[] {
    return filterCatalog(this.catalog, this.catalogSearch);
  }

  keyState(providerId: string): "set" | "new" | "none" | "command" {
    const provider = this.settings?.providers[providerId];
    if (provider?.auth?.command) return "command";
    if (provider?.apiKey) return "new";
    if (this.info?.providers.find((entry) => entry.id === providerId)?.apiKeySet) return "set";
    return "none";
  }

  probeKey(providerId: string, modelId: string): string {
    return probeKey(providerId, modelId);
  }

  async openPanel(section?: import("./settings/sections").SettingsSectionId): Promise<void> {
    this.requestedSection = section ?? null;
    if (!this.open && typeof document !== "undefined") {
      this.#returnFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.open = true;
    this.error = "";
    this.search = "";
    this.providerSearch = "";
    sendAgent({ type: "status" });
    await this.load();
    void this.loadCatalogStatus();
    if (this.catalog.length === 0) void this.loadCatalog();
  }

  close(): void {
    this.open = false;
    this.addOpen = false;
    this.testResult = null;
    this.search = "";
    this.providerSearch = "";
    const target = this.#returnFocus;
    this.#returnFocus = null;
    if (target) setTimeout(() => target.focus(), 0);
  }

  discard(): void {
    if (this.baseline) this.settings = clone(this.baseline);
    this.clearApiKeys = [];
    this.error = "";
    this.notice = "";
  }

  trackActivity(event: AgentEvent): void {
    if (event.type === "status") {
      const running = (event.sessions ?? []).filter((entry) => entry.running);
      this.#running = new Set(running.map((entry) => entry.sessionId));
      const { type: _type, ...info } = event;
      this.info = { ...(this.info ?? (info as AgentInfo)), ...info } as AgentInfo;
    } else if (event.type === "approval.requested" || event.type === "approval.resolved") {
      sendAgent({ type: "status" });
    } else if (event.type === "session.started") this.#running.add(event.sessionId);
    else if (event.type === "session.finished") this.#running.delete(event.sessionId);
    else if (event.type === "agent.exit") this.#running.clear();
    else return;
    this.runningTasks = this.#running.size;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = "";
    try {
      const response = await requestAgent<Response>({ type: "settings.get" });
      if (!response.settings) throw new Error("settings are missing in the response");
      this.settings = response.settings.config;
      this.baseline = clone(response.settings.config);
      this.info = {
        ...response.settings.info,
        ...(this.info?.approvals ? { approvals: this.info.approvals } : {}),
        ...(this.info?.sessions ? { sessions: this.info.sessions } : {}),
      };
      if (!this.selected || !this.settings.providers[this.selected]) {
        this.selected = this.settings.provider;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  async loadCatalogStatus(): Promise<void> {
    try {
      const response = await requestAgent<Response>({ type: "catalog.status" }, 60_000);
      this.catalogStatus = response.status ?? null;
    } catch {
      this.catalogStatus = null;
    }
  }

  async syncCatalog(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.error = "";
    try {
      const response = await requestAgent<Response>({ type: "catalog.sync" }, 90_000);
      this.catalogStatus = response.status ?? null;
      this.catalog = [];
      await this.loadCatalog();
      this.notice = t("Catalog updated");
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.syncing = false;
    }
  }

  async loadCatalog(): Promise<void> {
    if (this.catalogLoading) return;
    this.catalogLoading = true;
    try {
      const response = await requestAgent<Response>({ type: "catalog.list" }, 60_000);
      this.catalog = response.providers ?? [];
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.catalogLoading = false;
    }
  }

  select(id: string): void {
    this.selected = id;
    this.testResult = null;
  }

  async addReady(id: string): Promise<void> {
    if (!this.settings) return;
    const existing = this.settings.providers[id];
    if (existing) {
      this.selected = id;
      this.addOpen = false;
      return;
    }
    this.discovering = true;
    this.error = "";
    try {
      const response = await requestAgent<Response>({ type: "catalog.provider", id }, 60_000);
      const provider = response.provider;
      if (!provider) throw new Error("catalog provider is missing");
      const sameUrl = providerWithBaseUrl(this.settings, provider.baseUrl);
      const current = sameUrl ? this.settings.providers[sameUrl] : undefined;
      if (sameUrl && current) {
        this.notice = mergeModels(current, provider.models as Record<string, ModelInfo>, sameUrl);
        this.#added(sameUrl);
        return;
      }
      this.settings.providers[id] = {
        ...emptyProvider(provider.protocol, provider.baseUrl),
        name: provider.name,
        ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {}),
        models: clone(provider.models) as Record<string, ModelInfo>,
      };
      this.#added(id);
      this.notice = t("Added {0}: {1}", [
        provider.name,
        modelsCount(Object.keys(provider.models).length),
      ]);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.discovering = false;
    }
  }

  async discover(): Promise<void> {
    if (!this.settings) return;
    const baseUrl = this.custom.baseUrl.trim();
    if (baseUrl.length === 0) {
      this.error = t("Enter a base URL");
      return;
    }
    this.discovering = true;
    this.error = "";
    this.discoverResult = null;
    try {
      const response = await requestAgent<Response>(
        {
          type: "provider.discover",
          protocol: this.custom.protocol,
          baseUrl,
          ...(this.custom.apiKey ? { apiKey: this.custom.apiKey } : {}),
        },
        90_000,
      );
      const result = response.result as DiscoverResult | undefined;
      if (!result) throw new Error("discovery did not return models");
      this.discoverResult = result;
      const sameUrl = providerWithBaseUrl(this.settings, result.baseUrl);
      const current = sameUrl ? this.settings.providers[sameUrl] : undefined;
      if (sameUrl && current) {
        this.notice = mergeModels(current, result.models, sameUrl);
        if (this.custom.apiKey) current.apiKey = this.custom.apiKey;
        this.#added(sameUrl, true);
        return;
      }
      const id = uniqueProviderId(this.settings, result.providerId);
      this.settings.providers[id] = {
        ...emptyProvider(result.protocol, result.baseUrl),
        name: result.providerName || hostName(result.baseUrl),
        ...(this.custom.apiKey ? { apiKey: this.custom.apiKey } : {}),
        models: clone(result.models),
      };
      this.#added(id, true);
      this.notice =
        result.warnings.length > 0
          ? t("Added {0}: {1}, {2} without a catalog", [
              result.providerName,
              modelsCount(Object.keys(result.models).length),
              result.warnings.length,
            ])
          : t("Added {0}: {1}", [
              result.providerName,
              modelsCount(Object.keys(result.models).length),
            ]);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.discovering = false;
    }
  }

  /** A provider joined the draft: select it, close the add dialog, test a custom one. */
  #added(id: string, custom = false): void {
    if (!this.settings) return;
    activateIfNeeded(this.settings, id);
    this.selected = id;
    this.addOpen = false;
    if (!custom) return;
    this.custom.apiKey = "";
    this.custom.baseUrl = "";
    void this.test(id);
  }

  actualizeProvider(id: string): Promise<void> {
    return actualizeProvider(this, id);
  }

  probe(providerId: string, modelId: string): Promise<void> {
    return probeModel(this, providerId, modelId);
  }

  async save(): Promise<void> {
    if (!this.settings) return;
    const blocked = saveBlocker({
      saving: this.saving,
      dirty: this.dirty,
    });
    if (blocked) {
      this.error = blocked;
      return;
    }
    if (this.validationIssue) {
      this.error = this.validationIssue;
      return;
    }
    const active = this.settings.providers[this.settings.provider];
    if (!active) {
      this.error = t("Select an active provider");
      return;
    }
    if (!this.settings.model || !active.models[this.settings.model]) {
      const first = Object.keys(active.models)[0];
      if (!first) {
        this.error = t("The active provider has no models");
        return;
      }
      this.settings.model = first;
    }
    const cleaned = cleanSettings(this.settings);
    this.saving = true;
    this.error = "";
    this.notice = "";
    try {
      const response = await requestAgent<Response>(
        {
          type: "settings.save",
          config: cleaned,
          ...(this.clearApiKeys.length > 0 ? { clearApiKeys: [...this.clearApiKeys] } : {}),
        },
        60_000,
      );
      if (response.info) {
        this.info = response.info;
        applyPreferences(response.info.ui);
      }
      this.clearApiKeys = [];
      await this.load();
      this.notice = t("Saved");
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.saving = false;
    }
  }

  async setActive(providerId: string, modelId: string): Promise<void> {
    if (!this.settings) return;
    this.settings.provider = providerId;
    this.settings.model = modelId;
    await this.save();
  }

  removeProvider(id: string): void {
    if (!this.settings) return;
    const ids = Object.keys(this.settings.providers);
    if (ids.length <= 1) {
      this.error = t("Cannot delete the last provider");
      return;
    }
    delete this.settings.providers[id];
    this.clearApiKeys = this.clearApiKeys.filter((entry) => entry !== id);
    if (this.selected === id) {
      this.selected = Object.keys(this.settings.providers)[0] ?? null;
    }
    if (this.settings.provider === id) {
      this.settings.provider = this.selected ?? "";
      const models = this.selected
        ? Object.keys(this.settings.providers[this.selected]?.models ?? {})
        : [];
      this.settings.model = models[0] ?? "";
    }
  }

  toggleClearKey(id: string): void {
    this.clearApiKeys = this.clearApiKeys.includes(id)
      ? this.clearApiKeys.filter((entry) => entry !== id)
      : [...this.clearApiKeys, id];
    const provider = this.settings?.providers[id];
    if (provider && this.clearApiKeys.includes(id)) delete provider.apiKey;
  }

  removeModel(providerId: string, modelId: string): void {
    const provider = this.settings?.providers[providerId];
    if (!provider) return;
    if (Object.keys(provider.models).length <= 1) {
      this.error = t("Cannot delete the provider's last model");
      return;
    }
    delete provider.models[modelId];
    if (this.settings?.provider === providerId && this.settings.model === modelId) {
      this.settings.model = Object.keys(provider.models)[0] ?? "";
    }
  }

  applyName(providerId: string, modelId: string): void {
    const model = this.settings?.providers[providerId]?.models[modelId];
    if (model) model.name = formatModelName(modelId);
  }

  test(providerId: string, modelId?: string): Promise<void> {
    return testProvider(this, providerId, modelId);
  }
}

export const settings = new SettingsStore();
if (typeof window !== "undefined") {
  onAgentEvent((event) => settings.trackActivity(event));
}
