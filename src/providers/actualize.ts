import type { ModelConfig } from "../config/schema";

const DISCOVERED_MODEL_KEYS: Array<keyof ModelConfig> = [
  "context",
  "input",
  "output",
  "tools",
  "reasoning",
  "reasoningMode",
  "reasoningLevels",
  "reasoningBudget",
  "reasoningToggle",
  "vision",
  "temperature",
  "cost",
  "knowledge",
  "releaseDate",
  "openWeights",
  "attachment",
  "modalities",
  "canonicalId",
  "source",
];

export interface ModelDiffEntry {
  id: string;
  fields: string[];
}

export interface ActualizeResult {
  models: Record<string, ModelConfig>;
  added: string[];
  removed: string[];
  updated: ModelDiffEntry[];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function actualizeModels(
  existing: Record<string, ModelConfig>,
  discovered: Record<string, ModelConfig>,
): ActualizeResult {
  const models: Record<string, ModelConfig> = {};
  const added: string[] = [];
  const updated: ModelDiffEntry[] = [];
  for (const [id, incoming] of Object.entries(discovered)) {
    const current = existing[id];
    if (!current) {
      models[id] = { ...incoming };
      added.push(id);
      continue;
    }
    const merged: ModelConfig = { ...current };
    const fields: string[] = [];
    for (const key of DISCOVERED_MODEL_KEYS) {
      const value = incoming[key];
      if (value === undefined || sameValue(value, current[key])) continue;
      (merged as Record<string, unknown>)[key] = value;
      fields.push(key);
    }
    models[id] = merged;
    if (fields.length > 0) updated.push({ id, fields });
  }
  const removed = Object.keys(existing).filter((id) => discovered[id] === undefined);
  return { models, added, removed, updated };
}
