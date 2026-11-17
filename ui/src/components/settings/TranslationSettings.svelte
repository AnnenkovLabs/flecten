<script lang="ts">
  import Select from "../controls/Select.svelte";
  import Combobox from "../controls/Combobox.svelte";
  import { locales } from "../../lib/i18n/locales";
  import { t } from "../../lib/i18n.svelte";
  import type { HarnessSettings } from "../../lib/types";
  import SettingsRow from "./SettingsRow.svelte";

  let { config }: { config: HarnessSettings } = $props();
  const value = $derived(config.translation);
  const providers = $derived(Object.entries(config.providers));
  const models = $derived(Object.entries(config.providers[value?.provider ?? ""]?.models ?? {})
    .filter(([, model]) => model.tools !== false));
  function enable(enabled: boolean) {
    config.translation ??= { enabled: false, provider: config.provider, model: "", language: "auto", timeoutMs: 60000 };
    config.translation.enabled = enabled;
  }
</script>

<div class="st-group" hidden>
  <h3 class="st-group-title">{t("Agent language")}</h3>
  <div class="st-card">
    <label class="st-switch st-row">
      <span class="st-switch-copy">
        <strong>{t("Work in English")}</strong>
        <span>{t("Translate your request into English for the agent, and translate replies and progress updates into your language. The original request stays in history.")}</span>
      </span>
      <input type="checkbox" checked={value?.enabled ?? false}
        onchange={(event) => enable(event.currentTarget.checked)} />
      <span class="st-switch-track" aria-hidden="true"></span>
    </label>
    {#if value?.enabled}
      <SettingsRow title={t("Translation provider")}>
        <Select class="st-input" aria-label={t("Translation provider")} value={value.provider}
          onchange={(provider) => { value.provider = provider; value.model = ""; }}
          options={providers.map(([id, provider]) => ({ value: id, label: provider.name || id }))} />
      </SettingsRow>
      <SettingsRow title={t("Translation model")} description={t("Choose a fast, low-cost model without reasoning. Translation costs count toward the task budget.")}>
        <Select class="st-input" aria-label={t("Translation model")} bind:value={value.model}
          options={[{ value: "", label: t("Select a model"), disabled: true }, ...models.map(([id, model]) => ({ value: id, label: model.name || id }))]} />
      </SettingsRow>
      <SettingsRow title={t("Translation timeout")} description={t("Seconds per request. Translating long instructions may take more time than a short message.")}>
        <input class="st-input" type="number" min="1" max="120" step="1"
          aria-label={t("Translation timeout in seconds")} value={value.timeoutMs / 1000}
          oninput={(event) => { value.timeoutMs = event.currentTarget.valueAsNumber * 1000; }} />
      </SettingsRow>
      <SettingsRow title={t("Response language")} description={t("Auto uses the message language. For another language, enter its code, such as pl or ja.")}>
        <Combobox class="st-input" aria-label={t("Response language")} bind:value={value.language}
          options={[{ value: "auto", label: t("Auto") }, ...locales.map((locale) => ({ value: locale.id, label: locale.name, lang: locale.id }))]} />
      </SettingsRow>
    {/if}
  </div>
</div>
