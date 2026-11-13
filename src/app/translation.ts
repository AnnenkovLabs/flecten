import type { HarnessConfig } from "../config/schema";
import { createProvider } from "../providers/registry";
import type { ModelProvider } from "../providers/types";
import { TranslationClient } from "../translation/client";
import type { LanguageOptions } from "../translation/run";
import { maxOutputTokens } from "./provider-state";
import { usagePrice } from "./session-config";

/** Share only a bounded translation cache; the language itself belongs to each run. */
export function translationOptions() {
  let signature = "";
  let options: LanguageOptions | undefined;
  return (config: HarnessConfig): LanguageOptions | undefined => {
    const selected = config.translation;
    if (!selected?.enabled) {
      signature = "";
      options = undefined;
      return undefined;
    }
    const next = JSON.stringify([selected, config.providers[selected.provider], config.transport]);
    if (next !== signature) {
      const definition = config.providers[selected.provider];
      if (!definition) throw new Error("Translation provider is not configured");
      const target = {
        ...config,
        provider: selected.provider,
        model: selected.model,
        variant: undefined,
        providers: {
          ...config.providers,
          [selected.provider]: {
            ...definition,
            transport: {
              ...definition.transport,
              retries: 0,
              timeoutMs: selected.timeoutMs,
              idleTimeoutMs: selected.timeoutMs,
            },
          },
        },
        transport: { timeoutMs: selected.timeoutMs, idleTimeoutMs: selected.timeoutMs, retries: 0 },
        reasoning: "none" as const,
        failover: { enabled: false, providers: [] },
      };
      let adapter: ModelProvider | undefined;
      const provider: ModelProvider = {
        id: "translation",
        model: selected.model,
        stream(request, signal) {
          adapter ??= createProvider(target).provider;
          return adapter.stream(request, signal);
        },
      };
      options = {
        client: new TranslationClient(provider, selected.timeoutMs, maxOutputTokens(target)),
        language: selected.language,
        price: usagePrice(target),
        providerId: selected.provider,
      };
      signature = next;
    }
    return options;
  };
}
