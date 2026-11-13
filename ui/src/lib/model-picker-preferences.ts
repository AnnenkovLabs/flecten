import { z } from "zod";

const modelRefSchema = z.object({ provider: z.string(), model: z.string() });
export type ModelRef = z.infer<typeof modelRefSchema>;

const favoritesSchema = z.array(modelRefSchema);
const collapsedSchema = z.array(z.string());
const FAVORITES_KEY = "liquid.models.favorites";
const COLLAPSED_KEY = "liquid.models.collapsedProviders";
export const FAVORITES_LIMIT = 8;

function readStored(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The picker remains usable when storage is unavailable.
  }
}

export function readFavorites(): ModelRef[] {
  const result = favoritesSchema.safeParse(readStored(FAVORITES_KEY));
  return result.success ? result.data.slice(0, FAVORITES_LIMIT) : [];
}

export function saveFavorites(refs: ModelRef[]): void {
  writeStored(FAVORITES_KEY, refs);
}

export function readCollapsedProviders(): string[] {
  const result = collapsedSchema.safeParse(readStored(COLLAPSED_KEY));
  return result.success ? result.data : [];
}

export function saveCollapsedProviders(ids: string[]): void {
  writeStored(COLLAPSED_KEY, ids);
}
