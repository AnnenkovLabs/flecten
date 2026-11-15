import { isDeepStrictEqual } from "node:util";
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
  "structuredOutput",
  "audio",
  "pdf",
  "computerUse",
  "promptCache",
  "parallelToolCalls",
  "interleavedReasoning",
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

export interface ActualizeOptions {
  baseline?: Record<string, ModelConfig>;
  overwriteManual?: boolean;
}

/** Options enable automatic refresh; omission retains the explicit manual refresh behavior. */
export function actualizeModels(
  existing: Record<string, ModelConfig>,
  discovered: Record<string, ModelConfig>,
  options?: ActualizeOptions,
): ActualizeResult {
  const models: Record<string, ModelConfig> = {};
  const added: string[] = [];
  const updated: ModelDiffEntry[] = [];
  for (const [id, incoming] of Object.entries(discovered)) {
    const current = existing[id];
    const baseline = options?.baseline?.[id];
    if (!current) {
      if (options && !options.overwriteManual && baseline) continue;
      models[id] = { ...incoming };
      added.push(id);
      continue;
    }
    const merged: ModelConfig = { ...current };
    const fields: string[] = [];
    const keys: Array<keyof ModelConfig> = options
      ? ["name", ...DISCOVERED_MODEL_KEYS]
      : DISCOVERED_MODEL_KEYS;
    for (const key of keys) {
      const value = incoming[key];
      if (value === undefined || isDeepStrictEqual(value, current[key])) continue;
      if (
        options &&
        !options.overwriteManual &&
        (baseline ? !isDeepStrictEqual(current[key], baseline[key]) : current[key] !== undefined)
      )
        continue;
      (merged as Record<string, unknown>)[key] = value;
      fields.push(key);
    }
    if (
      options &&
      merged.context !== undefined &&
      ((merged.input !== undefined && merged.input > merged.context) ||
        (merged.output !== undefined && merged.output > merged.context))
    ) {
      // A protected manual limit can conflict with fresh facts; retain the last valid limits.
      for (const key of ["context", "input", "output"] as const) {
        if (current[key] === undefined) delete merged[key];
        else merged[key] = current[key];
        const index = fields.indexOf(key);
        if (index >= 0) fields.splice(index, 1);
      }
    }
    models[id] = merged;
    if (fields.length > 0) updated.push({ id, fields });
  }
  const removed: string[] = [];
  for (const [id, current] of Object.entries(existing)) {
    if (discovered[id] !== undefined) continue;
    // Probe observations do not turn an unchanged imported model into a manual edit.
    if (
      options &&
      !options.overwriteManual &&
      !isDeepStrictEqual(
        { ...current, verified: undefined },
        { ...options.baseline?.[id], verified: undefined },
      )
    ) {
      models[id] = current;
      continue;
    }
    removed.push(id);
  }
  return { models, added, removed, updated };
}
