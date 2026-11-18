import { isDeepStrictEqual } from "node:util";
import type { ModelConfig } from "../config/schema";
import { trimTrailingSlashes, withoutPrefix } from "../util/text";
import type { CatalogProvider } from "./catalog";

// Explicit derivative aliases authorized for metadata lookup. Keep checkpoint/version digits.
// ponytail: only these declared modifiers are removable; add new spellings with regression cases.
const DERIVATIVE_MODIFIERS = ["uncensored", "abliterated"];
const FIRST_PARTY_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "moonshotai",
  "zai",
  "alibaba",
  "mistral",
  "xai",
  "meta",
]);

interface Entry {
  id: string;
  idKey: string;
  canonicalKey?: string;
  baseKey: string;
  canonicalBaseKey?: string;
  model: ModelConfig;
  provider?: CatalogProvider;
}

function identity(id: string): string {
  return withoutPrefix(id.trim(), "~").toLowerCase();
}

/** Ignore namespace and separators, preserving boundaries between numeric groups: 4.1 != 41. */
function baseIdentity(id: string): string {
  let leaf = identity(id).split("/").at(-1) ?? "";
  for (const modifier of DERIVATIVE_MODIFIERS) leaf = leaf.replaceAll(modifier, "");
  let output = "";
  let previousNumber = false;
  let gap = false;
  for (const char of leaf) {
    const number = char >= "0" && char <= "9";
    if (number || (char >= "a" && char <= "z")) {
      if (number && previousNumber && gap) output += ".";
      output += char;
      previousNumber = number;
      gap = false;
    } else gap = true;
  }
  return output;
}

function toEntry(id: string, model: ModelConfig, provider?: CatalogProvider): Entry {
  const canonicalKey = model.canonicalId ? identity(model.canonicalId) : undefined;
  const canonicalBaseKey = model.canonicalId ? baseIdentity(model.canonicalId) : undefined;
  return {
    id,
    idKey: identity(id),
    ...(canonicalKey ? { canonicalKey } : {}),
    baseKey: baseIdentity(id),
    ...(canonicalBaseKey ? { canonicalBaseKey } : {}),
    model,
    ...(provider ? { provider } : {}),
  };
}

function matchTier(entry: Entry, targetIdKey: string, targetBase: string): number | undefined {
  if (entry.idKey === targetIdKey) return 0;
  if (entry.canonicalKey === targetIdKey) return 1;
  return targetBase && (entry.baseKey === targetBase || entry.canonicalBaseKey === targetBase)
    ? 2
    : undefined;
}

function originalProvider(entry: Entry): boolean {
  if (!entry.provider) return false;
  const canonical = entry.model.canonicalId;
  if (canonical?.includes("/")) {
    return identity(canonical).split("/")[0] === identity(entry.provider.id);
  }
  return !entry.id.includes("/") && FIRST_PARTY_PROVIDERS.has(identity(entry.provider.id));
}

function agreedModel(entries: Entry[], target: string): ModelConfig | undefined {
  const targetBase = baseIdentity(target);
  const first =
    entries.find((entry) => entry.model.name && baseIdentity(entry.model.name) === targetBase)
      ?.model ?? entries[0]?.model;
  if (!first) return undefined;
  const metadata = ({ name: _name, ...value }: ModelConfig) => value;
  return entries.every((entry) => isDeepStrictEqual(metadata(entry.model), metadata(first)))
    ? first
    : undefined;
}

function matchingModel(
  entries: Entry[],
  target: string,
  preferOriginal: boolean,
): ModelConfig | undefined {
  const targetIdKey = identity(target);
  const targetBase = baseIdentity(target);
  const matches = entries.flatMap((entry) => {
    const tier = matchTier(entry, targetIdKey, targetBase);
    return tier === undefined ? [] : [{ entry, tier }];
  });
  if (matches.length === 0) return undefined;
  if (preferOriginal) {
    const originals = matches.filter(({ entry }) => originalProvider(entry));
    if (originals.length > 0) {
      const agreed = agreedModel(
        originals.map(({ entry }) => entry),
        target,
      );
      if (agreed) return agreed;
    }
  }
  const tier = Math.min(...matches.map((match) => match.tier));
  return agreedModel(
    matches.filter((match) => match.tier === tier).map(({ entry }) => entry),
    target,
  );
}

function endpoint(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}${trimTrailingSlashes(url.pathname)}`;
  } catch {
    return trimTrailingSlashes(baseUrl);
  }
}

const fallbackCache = new WeakMap<Record<string, ModelConfig>, Entry[]>();

export function findProviderModel(
  providers: CatalogProvider[],
  modelId: string,
  baseUrl?: string,
): ModelConfig | undefined {
  const entries = providers.flatMap((provider) =>
    Object.entries(provider.models).map(([id, model]) => toEntry(id, model, provider)),
  );
  const targetEndpoint = baseUrl ? endpoint(baseUrl) : undefined;
  const own = targetEndpoint
    ? entries.filter(
        (entry) => entry.provider && endpoint(entry.provider.baseUrl) === targetEndpoint,
      )
    : [];
  return matchingModel(own, modelId, false) ?? matchingModel(entries, modelId, true);
}

export function findFallbackModel(
  models: Record<string, ModelConfig>,
  modelId: string,
): ModelConfig | undefined {
  let entries = fallbackCache.get(models);
  if (!entries) {
    entries = Object.entries(models).map(([id, model]) => toEntry(id, model));
    fallbackCache.set(models, entries);
  }
  return matchingModel(entries, modelId, false);
}
