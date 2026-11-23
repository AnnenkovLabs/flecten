<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { settings } from "../../lib/settings.svelte";
  import { linesToArray } from "../../lib/settings-utils";
  import SettingsRow from "./SettingsRow.svelte";

  const config = $derived(settings.settings);
</script>

{#if config?.sandbox}
  <section class="st-group" aria-labelledby="settings-sandbox">
    <h3 id="settings-sandbox" class="st-group-title">{t("Process isolation")}</h3>

    <div class="st-card">
      <label class="st-switch st-row">
        <span class="st-switch-copy">
          <strong>{t("Isolate processes")}</strong>
          <span>{t("Limit commands to the project and approved folders.")}</span>
        </span>
        <input type="checkbox" bind:checked={config.sandbox.enabled} />
        <span class="st-switch-track" aria-hidden="true"></span>
      </label>

      {#if config.sandbox.enabled}
        <label class="st-switch st-row">
          <span class="st-switch-copy">
            <strong>{t("Allow network in isolated commands")}</strong>
            <span>{t("Allow shell commands inside the sandbox to reach websites and external services.")}</span>
          </span>
          <input type="checkbox" bind:checked={config.sandbox.allowNetwork} />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
      {/if}
    </div>

    {#if config.sandbox.enabled && settings.info?.sandbox?.enabled}
      {#if settings.info.sandbox.available}
        <p class="st-group-note" role="status">
          {t("OS sandbox available")}: {settings.info.sandbox.kind}.
        </p>
      {:else}
        <p class="st-status st-status--warn" role="status">
          {t("OS sandbox unavailable")}: {settings.info.sandbox.reason}
        </p>
      {/if}
    {/if}

    {#if config.sandbox.enabled}
      <div class="st-card">
        <SettingsRow
          title={t("Blocked read paths")}
          description={t("One prefix per line. Use absolute paths or paths relative to the project root.")}
          stacked
        >
          <textarea
            class="st-input st-textarea"
            rows="2"
            aria-label={t("Blocked read paths")}
            value={(config.sandbox.readDenyPrefixes ?? []).join("\n")}
            oninput={(event) =>
              (config.sandbox!.readDenyPrefixes = linesToArray(event.currentTarget.value))}
          ></textarea>
        </SettingsRow>

        <SettingsRow title={t("Blocked write paths")} stacked>
          <textarea
            class="st-input st-textarea"
            rows="2"
            aria-label={t("Blocked write paths")}
            value={(config.sandbox.writeDenyPrefixes ?? []).join("\n")}
            oninput={(event) =>
              (config.sandbox!.writeDenyPrefixes = linesToArray(event.currentTarget.value))}
          ></textarea>
        </SettingsRow>

        <SettingsRow
          title={t("Environment variables")}
          description={t("Only these variables are available to commands and extensions. Provider keys are not passed on.")}
          stacked
        >
          <textarea
            class="st-input st-textarea"
            rows="3"
            aria-label={t("Environment variables")}
            value={(config.sandbox.envAllowlist ?? []).join("\n")}
            oninput={(event) =>
              (config.sandbox!.envAllowlist = linesToArray(event.currentTarget.value))}
          ></textarea>
        </SettingsRow>
      </div>
    {/if}
  </section>
{/if}
