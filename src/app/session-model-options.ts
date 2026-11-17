import { acceptsImages } from "../../shared/vision";
import type { HarnessConfig } from "../config/schema";
import { createProvider } from "../providers/registry";
import type { ModelProvider } from "../providers/types";
import { readTool } from "../tools/read/tool";
import { ToolRegistry } from "../tools/registry";
import {
  costOf,
  describeProviderError,
  maxOutputTokens,
  modelContext,
  unconfiguredProvider,
} from "./provider-state";
import { inputModalities } from "./service-policy";
import { usagePrice } from "./session-config";
import { visionOptions } from "./vision";

/** Rebuild model-dependent transport and capabilities from the owning chat's config. */
export function sessionModelOptions(config: HarnessConfig, provider?: ModelProvider) {
  return {
    provider: provider ?? configuredProvider(config).provider,
    providerId: config.provider,
    model: config.model,
    maxOutputTokens: maxOutputTokens(config),
    reasoning: config.reasoning,
    variant: config.variant,
    context: modelContext(config),
    price: usagePrice(config),
    priceFor: (provider: string, model: string) => {
      const definition = config.providers[provider]?.models[model];
      return definition
        ? (usage: import("../core/types").Usage) =>
            costOf(
              usage,
              definition,
              provider === config.provider && model === config.model ? config.variant : undefined,
            )
        : undefined;
    },
    modalities: inputModalities(config),
    vision: visionOptions(config),
  };
}

export function configuredProvider(config: HarnessConfig) {
  try {
    return { provider: createProvider(config).provider, configError: undefined };
  } catch (error) {
    return {
      provider: unconfiguredProvider(error, config.model),
      configError: describeProviderError(error, config.provider, config.providers[config.provider]),
    };
  }
}

/** Keep the shared catalog and authorization while exposing this model's image-read schema. */
export function sessionModelTools(config: HarnessConfig, tools: ToolRegistry): ToolRegistry {
  return new ToolRegistry(
    tools
      .list()
      .map((tool) =>
        tool.name === "read" && tools.source(tool.name) === "builtin"
          ? readTool(!acceptsImages(inputModalities(config)))
          : tool,
      ),
    {
      limits: config.tools,
      deferredMcp: tools.deferredMcp,
      authorize: (tool, context) => tools.authorize(tool.name, context),
    },
  );
}
