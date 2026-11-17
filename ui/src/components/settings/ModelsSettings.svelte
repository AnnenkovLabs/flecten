<script lang="ts">
  import type { ModelChoice } from "../../../../shared/model-choice";
  import { t } from "../../lib/i18n.svelte";
  import { settings } from "../../lib/settings.svelte";
  import { agentModelProviders, subagentModelRoles } from "../../lib/settings/model-defaults";
  import ModelDefaultRow from "./ModelDefaultRow.svelte";
  import TranslationSettings from "./TranslationSettings.svelte";
  import VisionSettings from "./VisionSettings.svelte";

  const config = $derived(settings.settings);
  const providers = $derived(config ? agentModelProviders(config) : []);
  const enabled = $derived(config?.conversation?.enabled ?? true);
  const roles = $derived(subagentModelRoles(settings.subagentRoles));
  const main = $derived<ModelChoice | undefined>(config ? {
    provider: config.provider, model: config.model,
    ...(config.reasoning ? { reasoning: config.reasoning } : {}),
    ...(config.variant ? { variant: config.variant } : {}),
  } : undefined);
  const talkerFallback = $derived.by(() => {
    const choice = config?.conversation?.worker ?? main;
    if (!choice) return undefined;
    const { provider, model, variant } = choice;
    return { provider, model, ...(variant ? { variant } : {}) };
  });

  function setMain(choice: ModelChoice | undefined): void {
    if (!config || !choice) return;
    config.provider = choice.provider;
    config.model = choice.model;
    if (choice.reasoning) config.reasoning = choice.reasoning;
    else delete config.reasoning;
    if (choice.variant) config.variant = choice.variant;
    else delete config.variant;
  }

  function setConversation(role: "talker" | "worker", choice: ModelChoice | undefined): void {
    if (!config) return;
    config.conversation ??= { enabled: true };
    if (choice) config.conversation[role] = choice;
    else delete config.conversation[role];
  }

  function setSubagent(role: string, choice: ModelChoice | undefined): void {
    if (!config) return;
    config.subagents ??= { dirs: [] };
    config.subagents.models ??= {};
    if (choice) config.subagents.models[role] = choice;
    else delete config.subagents.models[role];
  }
</script>

{#if config}
  <section class="settings-section models-settings" aria-labelledby="settings-models">
    <h2 id="settings-models">{t("Models")}</h2>
    <p class="st-section-description">{t("Defaults apply to new chats. You can still choose a model in the message box.")}</p>
    <div class="st-group">
      <h3 class="st-group-title">{t("Main model")}</h3>
      <div class="st-card">
        <ModelDefaultRow title={t("Default main model")}
          description={t("Used when Talker and Worker is off, and as the fallback for role defaults.")}
          {providers} choice={main} onChange={setMain} />
      </div>
    </div>
    <div class="st-group">
      <h3 class="st-group-title">{t("Talker and Worker")}</h3>
      <div class="st-card">
        <label class="st-switch st-row">
          <span class="st-switch-copy"><strong>{t("Separate conversation from execution")}</strong><span>{t("Talker handles your conversation. Worker carries out tasks with tools, for any kind of work.")}</span></span>
          <input type="checkbox" checked={enabled} onchange={(event) => { config.conversation = { ...config.conversation, enabled: event.currentTarget.checked }; }} />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
        <ModelDefaultRow title={t("Talker model")}
          description={t("Understands requests, asks questions, and explains progress and results.")}
          {providers} choice={config.conversation?.talker} fallback={talkerFallback}
          reasoningDefault="none" inherit={t("Use chat model")} disabled={!enabled}
          onChange={(choice) => setConversation("talker", choice)} />
        <ModelDefaultRow title={t("Worker model")}
          description={t("Executes tasks. A model selected in the message box overrides this default for that chat.")}
          {providers} choice={config.conversation?.worker} fallback={main} inherit={t("Use main model")} disabled={!enabled}
          onChange={(choice) => setConversation("worker", choice)} />
      </div>
    </div>
    <div class="st-group">
      <h3 class="st-group-title">{t("Subagent models")}</h3>
      <p class="st-section-description">{t("Choose a default for each role. Unset roles inherit the model of the agent that starts them.")}</p>
      <div class="st-card">
        {#each roles as role (role.id)}
          <ModelDefaultRow title={role.name} description={role.description} {providers}
            choice={config.subagents?.models?.[role.id]} inherit={t("Use parent model")}
            onChange={(choice) => setSubagent(role.id, choice)} />
        {/each}
      </div>
    </div>
    <VisionSettings {config} />
    {#if !enabled}<TranslationSettings {config} />{/if}
  </section>
{/if}
