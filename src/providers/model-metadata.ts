import type { ModelConfig, ProviderConfig } from "../config/schema";
import { findCatalogModel, formatModelName, syncCatalog } from "./catalog";
import { discoverProvider } from "./discovery";

export interface ModelMetadata {
  model: ModelConfig;
  warnings: string[];
}

/** Read metadata only. This never sends a generation request or changes saved settings. */
export async function modelMetadata(
  cwd: string,
  provider: ProviderConfig,
  modelId: string,
  apiKey?: string,
  refresh = false,
): Promise<ModelMetadata> {
  if (refresh) await syncCatalog(cwd);
  const warnings: string[] = [];
  try {
    const result = await discoverProvider(cwd, {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      ...(apiKey ? { apiKey } : {}),
      headers: provider.headers,
      ...(provider.proxy ? { proxy: provider.proxy } : {}),
      ...(provider.transportTimeoutMs ? { transportTimeoutMs: provider.transportTimeoutMs } : {}),
    });
    const model = result.models[modelId];
    if (model) return { model, warnings: result.warnings };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  const known = await findCatalogModel(cwd, modelId, provider.baseUrl);
  return {
    model: known ?? { name: formatModelName(modelId), source: "manual" },
    warnings,
  };
}
