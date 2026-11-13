<script lang="ts">
  import { i18n, setLocale, t } from "../../lib/i18n.svelte";
  import { locales } from "../../lib/i18n/locales";
  import { shortcutLabel } from "../../lib/platform";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import SettingsNumber from "./SettingsNumber.svelte";
  import SettingsRow from "./SettingsRow.svelte";
  import VoiceSettings from "./VoiceSettings.svelte";
  import VisionSettings from "./VisionSettings.svelte";
  import TranslationSettings from "./TranslationSettings.svelte";

  const config = $derived(settings.settings);
</script>

{#if config}
  <section class="settings-section" aria-labelledby="settings-general">
    <h2 id="settings-general">{t("General")}</h2>

    <div class="st-group">
      <div class="st-card">
        <SettingsRow title={t("Interface language")}
          description={t("The language of buttons, menus, and app messages. The language of agent replies is set separately.")}>
          <select class="st-input" aria-label={t("Interface language")} value={i18n.locale}
            onchange={(event) => setLocale(event.currentTarget.value)}>
            {#each locales as locale (locale.id)}
              <option value={locale.id} lang={locale.id}>{locale.name}</option>
            {/each}
          </select>
        </SettingsRow>
      </div>
    </div>

    <div class="st-group">
      <h3 class="st-group-title">{t("Messages")}</h3>
      <div class="st-card">
        <SettingsRow title={t("Send message")} description={t("Shift+Enter always adds a new line.")}>
          <select class="st-input" aria-label={t("Send message")}
            value={config.ui?.sendShortcut ?? "enter"}
            onchange={(event) => {
              config.ui ??= { sendShortcut: "enter", followUpBehavior: "queue" };
              config.ui.sendShortcut = event.currentTarget.value as "enter" | "modifier-enter";
            }}>
            <option value="enter">Enter</option>
            <option value="modifier-enter">{shortcutLabel("Enter")}</option>
          </select>
        </SettingsRow>
        <SettingsRow title={t("Messages while working")}>
          <select class="st-input" aria-label={t("Messages while working")}
            value={config.ui?.followUpBehavior ?? "queue"}
            onchange={(event) => {
              config.ui ??= { sendShortcut: "enter", followUpBehavior: "queue" };
              config.ui.followUpBehavior = event.currentTarget.value as "queue" | "steer";
            }}>
            <option value="queue">{t("After the current task")}</option>
            <option value="steer">{t("Guide the current task")}</option>
          </select>
        </SettingsRow>
      </div>
    </div>

    <VisionSettings {config} />

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

    <details class="st-details">
      <summary>{t("Advanced settings")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
      <div class="st-details-body">
        <div class="st-group">
          <h3 class="st-group-title">{t("Talker and Worker")}</h3>
          <div class="st-card">
            <label class="st-switch st-row">
              <span class="st-switch-copy"><strong>{t("Separate conversation from execution")}</strong><span>{t("New chats use a Talker and an independent Worker. Both use the selected model. English handoffs replace automatic translation; tool output stays live.")}</span></span>
              <input type="checkbox" checked={config.conversation?.enabled ?? true} onchange={(event) => { config.conversation = { enabled: event.currentTarget.checked }; }} />
              <span class="st-switch-track" aria-hidden="true"></span>
            </label>
          </div>
        </div>
        {#if config.conversation?.enabled === false}<TranslationSettings {config} />{/if}
      </div>
    </details>
  </section>
{/if}
