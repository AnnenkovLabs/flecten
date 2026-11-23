<script lang="ts">
  import Select from "../controls/Select.svelte";
  import { i18n, setLocale, t } from "../../lib/i18n.svelte";
  import { locales } from "../../lib/i18n/locales";
  import { shortcutLabel } from "../../lib/platform";
  import { settings } from "../../lib/settings.svelte";
  import SettingsNumber from "./SettingsNumber.svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import VoiceSettings from "./VoiceSettings.svelte";

  const config = $derived(settings.settings);
</script>

{#if config}
  <section class="settings-section" aria-labelledby="settings-general">
    <h2 id="settings-general">{t("General")}</h2>

    <div class="st-group">
      <div class="st-card">
        <SettingsRow title={t("Interface language")}
          description={t("The language of buttons, menus, and app messages. The language of agent replies is set separately.")}>
          <Select class="st-input" aria-label={t("Interface language")} value={i18n.locale}
            options={locales.map((locale) => ({ value: locale.id, label: locale.name, lang: locale.id }))}
            onchange={(value) => setLocale(value)} />
        </SettingsRow>
      </div>
    </div>

    <div class="st-group">
      <h3 class="st-group-title">{t("Messages")}</h3>
      <div class="st-card">
        <SettingsRow title={t("Send message")} description={t("Shift+Enter always adds a new line.")}>
          <Select class="st-input" aria-label={t("Send message")}
            value={config.ui?.sendShortcut ?? "enter"}
            options={[{ value: "enter", label: "Enter" }, { value: "modifier-enter", label: shortcutLabel("Enter") }]}
            onchange={(value) => {
              config.ui ??= { sendShortcut: "enter", followUpBehavior: "queue" };
              config.ui.sendShortcut = value as "enter" | "modifier-enter";
            }} />
        </SettingsRow>
        <SettingsRow title={t("Messages while working")}>
          <Select class="st-input" aria-label={t("Messages while working")}
            value={config.ui?.followUpBehavior ?? "queue"}
            options={[{ value: "queue", label: t("After the current task") }, { value: "steer", label: t("Guide the current task") }]}
            onchange={(value) => {
              config.ui ??= { sendShortcut: "enter", followUpBehavior: "queue" };
              config.ui.followUpBehavior = value as "queue" | "steer";
            }} />
        </SettingsRow>
      </div>
    </div>

    <VoiceSettings />

    {#if config.sessions}
      <div class="st-group">
        <h3 class="st-group-title">{t("Tasks")}</h3>
        <div class="st-card">
          <label class="st-switch st-row">
            <span class="st-switch-copy">
              <strong>{t("Resume after a crash")}</strong>
              <span>{t("Restore tasks when the app starts.")}</span>
            </span>
            <input type="checkbox" bind:checked={config.sessions.autoResume} />
            <span class="st-switch-track" aria-hidden="true"></span>
          </label>
          <SettingsNumber title={t("Concurrent tasks")}
            value={config.sessions.maxConcurrent} max={16}
            oninput={(value) => { if (config.sessions) config.sessions.maxConcurrent = value!; }} />
        </div>
      </div>
    {/if}

  </section>
{/if}
