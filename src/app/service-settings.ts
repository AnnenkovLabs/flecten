import { mergeModelDraft } from "../../shared/model-draft";
import { type HarnessConfig, HarnessConfigSchema } from "../config/schema";
import { configWithAccessMode } from "./access";
import { mergeSecrets } from "./provider-secrets";
import { sanitizeConfig } from "./service-policy";
import type { AppInfo, AppService, ModelChoiceInput } from "./service-types";
import { validateModelChoice, withModelChoice } from "./session-models";

/** Global settings mutations share the service's serialized commit and live config. */
export function settingsActions(
  current: () => HarnessConfig,
  commit: (
    next: HarnessConfig | (() => HarnessConfig),
    clearSecrets?: string[],
  ) => Promise<unknown>,
  info: () => AppInfo,
  selectSession?: (input: ModelChoiceInput & { sessionId: string }) => Promise<AppInfo>,
): Pick<AppService, "settings" | "setAccessMode" | "saveSettings" | "setModel"> {
  return {
    settings: () => ({ config: sanitizeConfig(current()), info: info() }),
    setAccessMode: (mode) => commit(() => configWithAccessMode(current(), mode)).then(info),
    async saveSettings(input) {
      const parsed = HarnessConfigSchema.parse(input.config);
      const baseline =
        input.baseline === undefined ? undefined : HarnessConfigSchema.parse(input.baseline);
      const clear = input.clearApiKeys ?? [];
      await commit(() => {
        const live = current();
        const next = { ...mergeSecrets(parsed, live, clear), useDefaults: false };
        for (const [id, provider] of Object.entries(next.providers)) {
          const saved = live.providers[id];
          const original = baseline?.providers[id];
          if (!saved || !original) continue;
          if (provider.protocol !== original.protocol || provider.baseUrl !== original.baseUrl)
            continue;
          provider.models = mergeModelDraft(saved.models, provider.models, original.models);
          provider.modelMetadataBaseline = mergeModelDraft(
            saved.modelMetadataBaseline ?? {},
            provider.modelMetadataBaseline ?? {},
            original.modelMetadataBaseline ?? {},
          );
        }
        return HarnessConfigSchema.parse(next);
      }, clear);
      return info();
    },
    async setModel(input) {
      const config = current();
      validateModelChoice(config, input);
      if (input.sessionId !== undefined) {
        if (!selectSession) throw new Error("Session model selection is unavailable");
        return selectSession({ ...input, sessionId: input.sessionId });
      }
      await commit(() => withModelChoice(current(), input));
      return info();
    },
  };
}
