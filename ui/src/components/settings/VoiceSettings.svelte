<script lang="ts">
  import Select from "../controls/Select.svelte";
  import { t } from "../../lib/i18n.svelte";
  import { settings } from "../../lib/settings.svelte";
  import { localVoiceDefaults } from "../../lib/voice-settings";
  import LocalVoiceSettings from "./LocalVoiceSettings.svelte";
  import SettingsRow from "./SettingsRow.svelte";

  const config = $derived(settings.settings);
  const engine = $derived(config?.voice?.engine ?? "api");
  const providers = $derived(Object.entries(config?.providers ?? {}).filter(([, entry]) =>
    entry.protocol === "openai-chat" || entry.protocol === "openai-responses"));
  function update(field: "provider" | "model" | "language" | "engine", value: string): void {
    if (!config) return;
    config.voice ??= { provider: "", model: "whisper-1", language: "auto" };
    if (field === "language") {
      if (value === "auto" || value === "ru" || value === "uk" || value === "en") config.voice.language = value;
    } else if (field === "engine") {
      if (value !== "api" && value !== "faster-whisper" && value !== "vosk") return;
      config.voice.engine = value;
      if (value !== "api") config.voice.local ??= localVoiceDefaults();
    } else config.voice[field] = value;
  }
</script>

{#if config}
  <div class="st-group">
    <h3 class="st-group-title">{t("Voice input")}</h3>
    <div class="st-card">
      <SettingsRow title={t("Speech recognition")} stacked>
        <Select class="st-input" style="width: min(100%, 400px)" aria-label={t("Recognition engine")} value={engine}
          options={[{ value: "api", label: t("Via provider") }, { value: "faster-whisper", label: t("On this computer · Whisper") }, { value: "vosk", label: t("On this computer · Vosk") }]}
          onchange={(value) => update("engine", value)} />
      </SettingsRow>
      {#if engine === "api"}
        <SettingsRow title={t("Speech recognition provider")} description={t("Audio is sent to the selected provider.")}>
          <Select class="st-input" aria-label={t("Speech recognition provider")}
            value={config.voice?.provider ?? ""}
            options={[{ value: "", label: t("Current provider") }, ...providers.map(([id, entry]) => ({ value: id, label: entry.name ?? id }))]}
            onchange={(value) => update("provider", value)} />
        </SettingsRow>
        <SettingsRow title={t("Speech recognition model")}>
          <input class="st-input" aria-label={t("Speech recognition model")} value={config.voice?.model ?? "whisper-1"}
            oninput={(event) => update("model", event.currentTarget.value)} />
        </SettingsRow>
      {:else if config.voice?.local}
        {#key engine}<LocalVoiceSettings {engine} options={config.voice.local} />{/key}
      {/if}
      {#if engine !== "vosk"}
        <SettingsRow title={t("Speech language")}>
          <Select class="st-input" aria-label={t("Speech language")} value={config.voice?.language ?? "auto"}
            options={[{ value: "auto", label: t("Auto") }, { value: "ru", label: t("Russian") }, { value: "uk", label: t("Ukrainian") }, { value: "en", label: "English" }]}
            onchange={(value) => update("language", value)} />
        </SettingsRow>
      {/if}
    </div>
  </div>
{/if}
