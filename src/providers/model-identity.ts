import { isDeepStrictEqual } from "node:util";
import type { ModelConfig } from "../config/schema";
import { trimTrailingSlashes, withoutPrefix } from "../util/text";
import type { CatalogProvider } from "./catalog";

// Explicit derivative aliases authorized for metadata lookup. Keep checkpoint/version digits.
// ponytail: only these declared modifiers are removable; add new spellings with regression cases.
const DERIVATIVE_MODIFIERS = ["uncensored", "abliterated"];

interface Entry {
  id: string;
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

function matchTier(entry: Entry, target: string): number | undefined {
  if (identity(entry.id) === identity(target)) return 0;
  if (entry.model.canonicalId && identity(entry.model.canonicalId) === identity(target)) return 1;
  const base = baseIdentity(target);
  return base &&
    (baseIdentity(entry.id) === base ||
      (entry.model.canonicalId && baseIdentity(entry.model.canonicalId) === base))
    ? 2
    : undefined;
}

function originalProvider(entry: Entry): boolean {
  const canonical = entry.model.canonicalId;
  if (!canonical?.includes("/") || !entry.provider) return false;
  return identity(canonical).split("/")[0] === identity(entry.provider.id);
}

function agreedModel(entries: Entry[], target: string): ModelConfig | undefined {
  const first =
    entries.find(
      (entry) => entry.model.name && baseIdentity(entry.model.name) === baseIdentity(target),
    )?.model ?? entries[0]?.model;
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
  const matches = entries.flatMap((entry) => {
    const tier = matchTier(entry, target);
    return tier === undefined ? [] : [{ entry, tier }];
  });
  if (preferOriginal) {
    const originals = matches.filter(({ entry }) => originalProvider(entry));
    if (originals.length > 0)
      return agreedModel(
        originals.map(({ entry }) => entry),
        target,
      );
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

export function findProviderModel(
  providers: CatalogProvider[],
  modelId: string,
  baseUrl?: string,
): ModelConfig | undefined {
  const entries = providers.flatMap((provider) =>
    Object.entries(provider.models).map(([id, model]) => ({ id, model, provider })),
  );
  const own = baseUrl
    ? entries.filter((entry) => endpoint(entry.provider.baseUrl) === endpoint(baseUrl))
    : [];
  return matchingModel(own, modelId, false) ?? matchingModel(entries, modelId, true);
}

export function findFallbackModel(
  models: Record<string, ModelConfig>,
  modelId: string,
): ModelConfig | undefined {
  return matchingModel(
    Object.entries(models).map(([id, model]) => ({ id, model })),
    modelId,
    false,
  );
}
