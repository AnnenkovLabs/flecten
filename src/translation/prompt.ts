import { prefixHash } from "../context/compactor";
import { estimateTokens } from "../context/tokenizer";
import { PROFILE_4 } from "../context/types";
import { type PromptStamp, promptVersion } from "../core/prompt";
import type { ToolSchema } from "../providers/types";

/** Provenance describes the actual English prefix, not the original project instructions. */
export function translatedPromptStamp(
  system: string,
  original: PromptStamp,
  tools: ToolSchema[],
): PromptStamp {
  const tokens =
    estimateTokens(system, PROFILE_4).tokens +
    estimateTokens(JSON.stringify(tools), PROFILE_4).tokens;
  return {
    ...original,
    version: promptVersion(system),
    hash: prefixHash(system, JSON.stringify(tools)),
    tokens,
    overBudget: tokens > original.maxTokens,
    parts: [{ id: "translated-system", tokens, trimmed: false, omitted: false }],
  };
}
