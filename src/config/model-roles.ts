import { z } from "zod";
import { type ModelChoice, ModelChoiceSchema } from "../../shared/model-choice";

interface ModelRoleConfig {
  providers: Record<
    string,
    {
      models: Record<
        string,
        {
          disabled?: boolean | undefined;
          tools?: boolean | undefined;
          variants?: Record<string, unknown> | undefined;
        }
      >;
    }
  >;
  conversation?: { talker?: ModelChoice | undefined; worker?: ModelChoice | undefined } | undefined;
  subagents?: { models?: Record<string, ModelChoice> | undefined } | undefined;
}

export const ConversationConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    talker: ModelChoiceSchema.optional(),
    worker: ModelChoiceSchema.optional(),
  })
  .default({ enabled: true })
  .optional();

/** Explicit role choices must remain usable when catalogs or provider settings change. */
export function modelChoiceError(config: ModelRoleConfig, choice: ModelChoice): string | undefined {
  const provider = config.providers[choice.provider];
  if (!provider) return `unknown provider: ${choice.provider}`;
  const model = provider.models[choice.model];
  if (!model && Object.keys(provider.models).length > 0)
    return `unknown model for ${choice.provider}: ${choice.model}`;
  if (model?.disabled) return `Model is disabled: ${choice.model}`;
  if (model?.tools === false) return `Model requires tool calling support: ${choice.model}`;
  if (choice.variant && !model?.variants?.[choice.variant])
    return `Unknown model variant: ${choice.variant}`;
}

export function validateRoleModels(config: ModelRoleConfig, context: z.RefinementCtx) {
  const choices = [
    { path: ["conversation", "talker"], choice: config.conversation?.talker },
    { path: ["conversation", "worker"], choice: config.conversation?.worker },
    ...Object.entries(config.subagents?.models ?? {}).map(([id, choice]) => ({
      path: ["subagents", "models", id],
      choice,
    })),
  ];
  for (const { path, choice } of choices) {
    if (!choice) continue;
    const message = modelChoiceError(config, choice);
    if (message) context.addIssue({ code: "custom", path, message });
  }
}
