// Edits of the provider list in the settings draft: find by URL, merge models, pick ids.
import { modelsCount } from "../format";
import { t } from "../i18n.svelte";
import { slugify } from "../model-name";
import { clone } from "../settings-utils";
import type { ModelInfo, ProviderSettings } from "../types";

type Draft = { provider: string; model: string; providers: Record<string, ProviderSettings> };

function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

/** The provider that already points at this base URL, ignoring case and trailing slashes. */
export function providerWithBaseUrl(draft: Draft, baseUrl: string): string | undefined {
  const target = withoutTrailingSlashes(baseUrl).toLowerCase();
  for (const [id, provider] of Object.entries(draft.providers)) {
    if (withoutTrailingSlashes(provider.baseUrl).toLowerCase() === target) return id;
  }
  return undefined;
}

/** Makes the provider active only when the current choice points at nothing. */
export function activateIfNeeded(draft: Draft, id: string): void {
  const first = Object.keys(draft.providers[id]?.models ?? {})[0];
  if (!first) return;
  if (draft.providers[draft.provider]?.models[draft.model]) return;
  draft.provider = id;
  draft.model = first;
}

export function uniqueProviderId(draft: Draft, base: string): string {
  const slug = slugify(base);
  let id = slug;
  for (let index = 2; draft.providers[id]; index += 1) id = `${slug}-${index}`;
  return id;
}

/** Adds fresh models to a provider that already exists; returns its name and model count. */
export function mergeModels(
  provider: ProviderSettings,
  models: Record<string, ModelInfo>,
  fallbackName: string,
): string {
  provider.models = { ...provider.models, ...clone(models) };
  return t("Updated {0}: {1}", [
    provider.name ?? fallbackName,
    modelsCount(Object.keys(provider.models).length),
  ]);
}

/** A copy for the connection test without empty optional fields. */
export function testableProvider(provider: ProviderSettings): ProviderSettings {
  const cleaned = clone(provider);
  if (cleaned.apiKey === "") delete cleaned.apiKey;
  if (cleaned.apiKeyEnv === "") delete cleaned.apiKeyEnv;
  if (cleaned.promptCacheKey === "") delete cleaned.promptCacheKey;
  return cleaned;
}

/** Apply a network refresh without discarding edits made before or during the request. */
export function refreshedDraftModels(
  fresh: Record<string, ModelInfo>,
  current: Record<string, ModelInfo>,
  baseline: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
  const merged = clone(fresh);
  for (const id of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    const draft = current[id];
    const saved = baseline[id];
    if (JSON.stringify(draft) === JSON.stringify(saved)) continue;
    if (!draft) {
      delete merged[id];
      continue;
    }
    if (!saved || !merged[id]) {
      merged[id] = clone(draft);
      continue;
    }
    const target = merged[id] as Record<string, unknown>;
    for (const key of new Set([...Object.keys(saved), ...Object.keys(draft)])) {
      const edited = (draft as Record<string, unknown>)[key];
      if (JSON.stringify(edited) === JSON.stringify((saved as Record<string, unknown>)[key]))
        continue;
      if (edited === undefined) delete target[key];
      else target[key] = clone(edited);
    }
  }
  return merged;
}
