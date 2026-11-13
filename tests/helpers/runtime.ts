import { type ProviderConfig, ProviderConfigSchema } from "../../src/config/schema";
import type { ProviderRuntime } from "../../src/providers/types";

export function runtime(
  baseUrl: string,
  overrides: Partial<ProviderConfig> = {},
  providerId = "test",
): ProviderRuntime {
  const config = ProviderConfigSchema.parse({
    protocol: "openai-chat",
    baseUrl,
    ...overrides,
  });
  return {
    providerId,
    protocol: config.protocol,
    baseUrl,
    headers: config.headers,
    config,
    modelConfig: (id) => config.models[id],
  };
}
