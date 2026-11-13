<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import SettingsNumber from "./SettingsNumber.svelte";
  const config = $derived(settings.settings);
</script>

{#if config?.checkpoints}
  <section class="settings-section" aria-labelledby="settings-history">
    <h2 id="settings-history">{t("History and rollback")}</h2>
    <div class="st-card">
      <label class="st-switch st-row">
        <span class="st-switch-copy">
          <strong>{t("Terminal command snapshots")}</strong>
          <span>{t("Save changes made by commands so they can be undone and reapplied.")}</span>
        </span>
        <input type="checkbox" bind:checked={config.checkpoints.shell} />
        <span class="st-switch-track" aria-hidden="true"></span>
      </label>
      <SettingsNumber title={t("Keep snapshots for (days)")} value={config.checkpoints.maxAgeDays} max={365}
        oninput={(value) => { if (config.checkpoints) config.checkpoints.maxAgeDays = value!; }} />
      <SettingsNumber title={t("Snapshot count")} value={config.checkpoints.keep} max={10_000}
        oninput={(value) => { if (config.checkpoints) config.checkpoints.keep = value!; }} />
    </div>
    <p class="st-group-note">{t("Clearing snapshots does not delete conversations.")}</p>
    {#if config.sessions}
      <h3 class="st-group-title">{t("Task retention")}</h3>
      <div class="st-card">
        <SettingsNumber title={t("Keep tasks for (days)")} value={config.sessions.retentionDays} oninput={(value) => { if (config.sessions) config.sessions.retentionDays = value!; }} />
        <SettingsNumber title={t("Number of tasks")} value={config.sessions.maxSessions} oninput={(value) => { if (config.sessions) config.sessions.maxSessions = value!; }} />
        <SettingsNumber title={t("Keep deleted tasks for (days)")} value={config.sessions.trashDays} min={0} oninput={(value) => { if (config.sessions) config.sessions.trashDays = value!; }} />
      </div>
      <p class="st-group-note">{t("Old completed tasks move to the trash. Active tasks and queued messages are kept. Export is available in the task menu.")}</p>
    {/if}
    <details class="st-details">
      <summary>{t("Command snapshot size")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
      <div class="st-details-body">
        <div class="st-card">
          <SettingsNumber title={t("Files per snapshot")} value={config.checkpoints.maxFiles} max={20_000}
            oninput={(value) => { if (config.checkpoints) config.checkpoints.maxFiles = value!; }} />
          <SettingsNumber title={t("Snapshot size (MiB)")} value={config.checkpoints.maxMegabytes} max={4096}
            oninput={(value) => { if (config.checkpoints) config.checkpoints.maxMegabytes = value!; }} />
        </div>
        <p class="st-group-note">{t("Files over the limit will not be included in the snapshot. History will show what was skipped.")}</p>
      </div>
    </details>
  </section>
{/if}
