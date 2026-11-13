<script lang="ts">
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
        <select class="st-input" style="width: min(100%, 400px)" aria-label={t("Recognition engine")} value={engine}
          onchange={(event) => update("engine", event.currentTarget.value)}>
          <option value="api">{t("Via provider")}</option>
          <option value="faster-whisper">{t("On this computer · Whisper")}</option>
          <option value="vosk">{t("On this computer · Vosk")}</option>
        </select>
      </SettingsRow>
      {#if engine === "api"}
        <SettingsRow title={t("Speech recognition provider")} description={t("Audio is sent to the selected provider.")}>
          <select class="st-input" aria-label={t("Speech recognition provider")}
            value={config.voice?.provider ?? ""} onchange={(event) => update("provider", event.currentTarget.value)}>
            <option value="">{t("Current provider")}</option>
            {#each providers as [id, entry]}<option value={id}>{entry.name ?? id}</option>{/each}
          </select>
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
          <select class="st-input" aria-label={t("Speech language")} value={config.voice?.language ?? "auto"}
            onchange={(event) => update("language", event.currentTarget.value)}>
            <option value="auto">{t("Auto")}</option><option value="ru">{t("Russian")}</option>
            <option value="uk">{t("Ukrainian")}</option><option value="en">English</option>
          </select>
        </SettingsRow>
      {/if}
    </div>
  </div>
{/if}
