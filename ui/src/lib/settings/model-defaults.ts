import type { ModelChoice } from "../../../../shared/model-choice";
import { t } from "../i18n.svelte";
import type { HarnessSettings, ProviderInfo } from "../types";

export function agentModelProviders(config: HarnessSettings): ProviderInfo[] {
  return Object.entries(config.providers)
    .map(([id, provider]) => ({
      id,
      name: provider.name || id,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKeySet: false,
      active: id === config.provider,
      models: Object.fromEntries(
        Object.entries(provider.models).filter(
          ([, model]) => !model.disabled && model.tools !== false,
        ),
      ),
    }))
    .filter((provider) => Object.keys(provider.models).length > 0);
}

export function defaultSubagentRoles(): { id: string; name: string; description: string }[] {
  return [
    {
      id: "explore",
      name: t("Explore"),
      description: t("Find information and understand the task."),
    },
    { id: "implement", name: t("Implement"), description: t("Carry out a focused assignment.") },
    { id: "review", name: t("Review"), description: t("Check results and identify risks.") },
  ];
}

export function subagentModelRoles(roles: { id: string; name: string; description: string }[]) {
  const builtins = defaultSubagentRoles();
  return roles.length
    ? roles.map((role) => builtins.find((builtin) => builtin.id === role.id) ?? role)
    : builtins;
}

export function agentModelIssue(config: HarnessSettings, choice: ModelChoice | undefined): string {
  if (!choice) return "";
  const model = config.providers[choice.provider]?.models[choice.model];
  if (!model || model.disabled || model.tools === false)
    return t("Choose an enabled model that supports tools.");
  if (choice.variant && !model.variants?.[choice.variant])
    return t("Choose a variant available for this model.");
  return "";
}
