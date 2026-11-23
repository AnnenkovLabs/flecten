// Live checks of a provider from settings: connection test, model probe and actualize.
import { requestAgent } from "../desktop";
import { modelsCount } from "../format";
import { t } from "../i18n.svelte";
import { clone } from "../settings-utils";
import type {
  AgentEvent,
  AgentInfo,
  HarnessSettings,
  ProbeResult,
  ProviderActualizeResult,
  ProviderTestResult,
} from "../types";
import { refreshedDraftModels, testableProvider } from "./provider-draft";

type Response = Extract<AgentEvent, { type: "response" }>;

export interface CheckHost {
  settings: HarnessSettings | null;
  baseline: HarnessSettings | null;
  info: AgentInfo | null;
  error: string;
  notice: string;
  testing: boolean;
  testResult: ProviderTestResult | null;
  probeResults: Record<string, ProbeResult | "loading">;
  actualizing: boolean;
  actualizeResult: ProviderActualizeResult | null;
  readonly dirty: boolean;
}

export function probeKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function failed(host: CheckHost, error: unknown): void {
  host.error = error instanceof Error ? error.message : String(error);
}

function actualizeNotice(result: ProviderActualizeResult): string {
  const probe = result.probe;
  const text = probe.text ? "ok" : t("none");
  const tools = probe.tools ? "ok" : t("none");
  const reasoning = probe.reasoning ? "ok" : t("not visible");
  return t("Updated: {0}, +{1}, −{2}; checks: text {3}, tools {4}, reasoning {5}", [
    modelsCount(result.models),
    result.added.length,
    result.removed.length,
    text,
    tools,
    reasoning,
  ]);
}

/** Refreshes the provider's models from the network; a clean draft stays clean. */
export async function actualizeProvider(host: CheckHost, id: string): Promise<void> {
  if (host.actualizing) return;
  const baseline = clone(host.baseline?.providers[id]?.models ?? {});
  host.actualizing = true;
  host.error = "";
  host.notice = "";
  host.actualizeResult = null;
  try {
    const response = await requestAgent<Response>({ type: "provider.actualize", id }, 240_000);
    const result = response.result as ProviderActualizeResult | undefined;
    const fresh = result?.info.providers.find((entry) => entry.id === id)?.models;
    const draft = host.settings?.providers[id];
    if (fresh && draft) draft.models = refreshedDraftModels(fresh, draft.models, baseline);
    if (fresh && host.baseline?.providers[id]) host.baseline.providers[id].models = clone(fresh);
    if (result?.modelMetadataBaseline) {
      if (draft) draft.modelMetadataBaseline = clone(result.modelMetadataBaseline);
      const saved = host.baseline?.providers[id];
      if (saved) saved.modelMetadataBaseline = clone(result.modelMetadataBaseline);
    }
    host.info = response.info ?? result?.info ?? host.info;
    host.actualizeResult = result ?? null;
    if (result) host.notice = actualizeNotice(result);
  } catch (error) {
    failed(host, error);
  } finally {
    host.actualizing = false;
  }
}

/** Probes one model and keeps its verified mark in the draft. */
export async function probeModel(host: CheckHost, providerId: string, modelId: string) {
  const key = probeKey(providerId, modelId);
  const wasDirty = host.dirty;
  host.probeResults = { ...host.probeResults, [key]: "loading" };
  host.error = "";
  try {
    const response = await requestAgent<Response>(
      { type: "model.probe", provider: providerId, model: modelId },
      120_000,
    );
    const result = response.result as ProbeResult | undefined;
    if (result) host.probeResults = { ...host.probeResults, [key]: result };
    if (response.info) host.info = response.info;
    const verified = response.info?.providers.find((entry) => entry.id === providerId)?.models[
      modelId
    ]?.verified;
    const draft = host.settings?.providers[providerId]?.models[modelId];
    if (verified && draft) draft.verified = clone(verified);
    if (!wasDirty && host.settings) host.baseline = clone(host.settings);
  } catch (error) {
    failed(host, error);
  }
}

function pickTestModels(host: CheckHost, providerId: string, selectedModel?: string): string[] {
  const provider = host.settings?.providers[providerId];
  if (!provider) return [];
  if (selectedModel) return provider.models[selectedModel] ? [selectedModel] : [];
  const ordered: string[] = [];
  const push = (id: string | undefined) => {
    if (id && provider.models[id] && !provider.models[id]?.disabled && !ordered.includes(id)) {
      ordered.push(id);
    }
  };
  if (host.settings?.provider === providerId) push(host.settings.model);
  const entries = Object.entries(provider.models).filter(([, m]) => !m.disabled);
  for (const [id, m] of entries) {
    if (m.tools !== false && m.source !== "api") push(id);
  }
  for (const [id, m] of entries) {
    if (m.tools !== false) push(id);
  }
  for (const [id] of entries) push(id);
  if (ordered.length === 0) {
    const first = Object.keys(provider.models)[0];
    if (first) ordered.push(first);
  }
  return ordered.slice(0, 2);
}

function isProviderLevelFailure(result: ProviderTestResult): boolean {
  if (result.errorKind === "missing_api_key" || result.errorKind === "transport_proxy") return true;
  return result.status === 401 || result.status === 403;
}

/** Tests the draft provider as typed, before it is saved. */
export async function testProvider(
  host: CheckHost,
  providerId: string,
  selectedModel?: string,
): Promise<void> {
  const provider = host.settings?.providers[providerId];
  if (!provider) return;
  const candidates = pickTestModels(host, providerId, selectedModel);
  if (candidates.length === 0) {
    host.error = t("Add a model first");
    return;
  }
  host.testing = true;
  host.testResult = null;
  host.error = "";
  try {
    const draft = await requestAgent<Response>(
      {
        type: "provider.draft",
        provider: testableProvider(provider),
        ...(host.info?.providers.some((entry) => entry.id === providerId) ? { providerId } : {}),
      },
      30_000,
    );
    const token = (draft.result as unknown as { draftToken?: string } | undefined)?.draftToken;
    if (!token) throw new Error("draft provider token is missing");
    let latest: ProviderTestResult | null = null;
    for (const model of candidates) {
      const response = await requestAgent<Response>(
        { type: "provider.test", draftToken: token, model },
        45_000,
      );
      latest = (response.result as ProviderTestResult | undefined) ?? null;
      if (!latest || latest.ok || selectedModel || isProviderLevelFailure(latest)) break;
    }
    host.testResult = latest;
  } catch (error) {
    failed(host, error);
  } finally {
    host.testing = false;
  }
}
