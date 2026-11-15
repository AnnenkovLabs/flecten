// Fetch model facts for a settings draft without saving it or requesting generation.
import { requestAgent } from "../desktop";
import { clone } from "../settings-utils";
import type { AgentEvent, AgentInfo, HarnessSettings, ModelInfo } from "../types";
import { testableProvider } from "./provider-draft";
import type { ModelMetadataResult } from "./provider-protocol";

type Response = Extract<AgentEvent, { type: "response" }>;
type MetadataHost = { settings: HarnessSettings | null; info: AgentInfo | null };

export async function fetchModelMetadata(
  host: MetadataHost,
  providerId: string,
  model: string,
  refresh = false,
): Promise<ModelMetadataResult> {
  const provider = host.settings?.providers[providerId];
  if (!provider) throw new Error("model provider is missing");
  const draft = await requestAgent<Response>(
    {
      type: "provider.draft",
      provider: testableProvider(provider),
      ...(host.info?.providers.some((entry) => entry.id === providerId) ? { providerId } : {}),
    },
    30_000,
  );
  if (!draft.result || !("draftToken" in draft.result)) {
    throw new Error("draft provider token is missing");
  }
  const response = await requestAgent<Response>(
    {
      type: "model.metadata",
      draftToken: draft.result.draftToken,
      model,
      refresh,
    },
    90_000,
  );
  if (!response.result || !("model" in response.result)) {
    throw new Error("model metadata is missing");
  }
  return response.result;
}

const METADATA_FIELDS = [
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
  "canonicalId",
  "modalities",
  "source",
] as const satisfies readonly (keyof ModelInfo)[];

/** Refresh only stated facts, keeping connection options and edits made while waiting. */
export function refreshedModelMetadata(
  current: ModelInfo,
  fresh: ModelInfo,
  baseline: ModelInfo,
): ModelInfo {
  const merged = clone(current);
  for (const key of METADATA_FIELDS) {
    if (fresh[key] === undefined || JSON.stringify(current[key]) !== JSON.stringify(baseline[key]))
      continue;
    (merged as Record<string, unknown>)[key] = clone(fresh[key]);
  }
  return merged;
}
