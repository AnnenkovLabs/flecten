import { type HarnessConfig, HarnessConfigSchema } from "../config/schema";
import { configWithAccessMode } from "./access";
import { mergeSecrets } from "./provider-secrets";
import { sanitizeConfig } from "./service-policy";
import type { AppInfo, AppService } from "./service-types";

/** Global settings mutations share the service's serialized commit and live config. */
export function settingsActions(
  current: () => HarnessConfig,
  commit: (
    next: HarnessConfig | (() => HarnessConfig),
    clearSecrets?: string[],
  ) => Promise<unknown>,
  info: () => AppInfo,
): Pick<AppService, "settings" | "setAccessMode" | "saveSettings" | "setModel"> {
  return {
    settings: () => ({ config: sanitizeConfig(current()), info: info() }),
    setAccessMode: (mode) => commit(() => configWithAccessMode(current(), mode)).then(info),
    async saveSettings(input) {
      const parsed = HarnessConfigSchema.parse(input.config);
      const clear = input.clearApiKeys ?? [];
      const next = { ...mergeSecrets(parsed, current(), clear), useDefaults: false };
      await commit(next, clear);
      return info();
    },
    async setModel(input) {
      const config = current();
      const definition = config.providers[input.provider];
      if (!definition) throw new Error(`unknown provider: ${input.provider}`);
      if (!definition.models[input.model] && Object.keys(definition.models).length > 0)
        throw new Error(`unknown model for ${input.provider}: ${input.model}`);
      const next: HarnessConfig = { ...config, provider: input.provider, model: input.model };
      if (input.reasoning) next.reasoning = input.reasoning;
      else delete next.reasoning;
      if (input.variant) next.variant = input.variant;
      else delete next.variant;
      await commit(next);
      return info();
    },
  };
}
