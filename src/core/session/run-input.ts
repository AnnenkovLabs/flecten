import type { ModelProvider } from "../../providers/types";
import { markdownData } from "../../util/markdown";

export type { MemoryPort as SessionMemory } from "../memory/types";

export function lastUsedTarget(
  provider: ModelProvider,
): { provider: string; model: string } | undefined {
  const candidate = (provider as { lastUsed?: unknown }).lastUsed;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const { provider: id, model } = candidate as { provider?: unknown; model?: unknown };
  return typeof id === "string" && typeof model === "string" ? { provider: id, model } : undefined;
}

export function promptWithHookContext(prompt: string, contexts: readonly string[]): string {
  if (contexts.length === 0) return prompt;
  const context = contexts
    .map((text) => markdownData("Hook context", [["Source", "configured hook"]], text))
    .join("\n\n");
  return `${context}\n\n${prompt}`;
}
