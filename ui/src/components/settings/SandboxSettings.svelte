<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { settings } from "../../lib/settings.svelte";
  import { linesToArray } from "../../lib/settings-utils";
  import SettingsRow from "./SettingsRow.svelte";

  const config = $derived(settings.settings);
</script>

{#if config}
  <section class="settings-section" aria-labelledby="settings-sandbox">
    <h2 id="settings-sandbox">{t("Sandbox")}</h2>

    {#if config.sandbox}
      <div class="st-card">
        <label class="st-switch st-row">
          <span class="st-switch-copy">
            <strong>{t("Enabled")}</strong>
            <span>{t("Check paths, secrets, and network access before execution.")}</span>
          </span>
          <input
            type="checkbox"
            bind:checked={config.sandbox.enabled}
            data-settings-field={t("Sandbox enabled")}
          />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>

        <label class="st-switch st-row">
          <span class="st-switch-copy">
            <strong>{t("Allow network access")}</strong>
            <span>{t("Access to websites and external services.")}</span>
          </span>
          <input
            type="checkbox"
            bind:checked={config.sandbox.allowNetwork}
            data-settings-field={t("Network allowNetwork")}
          />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="st-group">
        <h3 class="st-group-title">{t("Blocked paths")}</h3>
        <div class="st-card">
          <SettingsRow title={t("Read")} stacked>
            <textarea
              class="st-input st-textarea"
              rows="2"
              value={(config.sandbox.readDenyPrefixes ?? []).join("\n")}
              data-settings-field={t("Blocked read paths readDenyPrefixes")}
              oninput={(event) =>
                (config.sandbox!.readDenyPrefixes = linesToArray(event.currentTarget.value))}
            ></textarea>
          </SettingsRow>

          <SettingsRow title={t("Write")} stacked>
            <textarea
              class="st-input st-textarea"
              rows="2"
              value={(config.sandbox.writeDenyPrefixes ?? []).join("\n")}
              data-settings-field={t("Blocked write paths writeDenyPrefixes")}
              oninput={(event) =>
                (config.sandbox!.writeDenyPrefixes = linesToArray(event.currentTarget.value))}
            ></textarea>
          </SettingsRow>
        </div>
        <p class="st-group-note">{t("One prefix per line. Use absolute paths or paths relative to the project root.")}</p>
      </div>

      <div class="st-group">
        <h3 class="st-group-title">{t("Environment")}</h3>
        <div class="st-card">
          <SettingsRow title={t("Environment variables")} stacked>
            <textarea
              class="st-input st-textarea"
              rows="3"
              value={(config.sandbox.envAllowlist ?? []).join("\n")}
              data-settings-field={t("Environment variables envAllowlist")}
              oninput={(event) =>
                (config.sandbox!.envAllowlist = linesToArray(event.currentTarget.value))}
            ></textarea>
          </SettingsRow>
        </div>
        <p class="st-group-note"> {t("Only these variables are available to commands and extensions. Provider keys are not passed on.")} </p>
      </div>
    {:else}
      <div class="st-empty">{t("Sandbox is not configured. Save settings to create a configuration file.")}</div>
    {/if}
  </section>
{/if}
