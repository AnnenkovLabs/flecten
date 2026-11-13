<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { settings } from "../../lib/settings.svelte";
  import Icon from "../Icon.svelte";
  import SettingsNumber from "./SettingsNumber.svelte";
  import SettingsRow from "./SettingsRow.svelte";
  const config = $derived(settings.settings);
</script>

{#if config}
  <section class="settings-section" aria-labelledby="settings-tools">
    <h2 id="settings-tools">{t("Terminal and tools")}</h2>
    {#if config.terminal}
      <div class="st-group">
        <h3 class="st-group-title">{t("Terminal")}</h3>
        <div class="st-card">
          <SettingsRow title={t("Shell")}>
            <input class="st-input st-mono" aria-label={t("Shell")} placeholder={t("System default")}
              value={config.terminal.shell ?? ""}
              oninput={(event) => { if (config.terminal) config.terminal.shell = event.currentTarget.value.trim() || undefined; }} />
          </SettingsRow>
          <SettingsNumber title={t("Command wait time, s")} description={t("After this, the command continues in the background.")}
            value={config.terminal.commandTimeoutMs} scale={1000} max={600_000}
            oninput={(value) => { if (config.terminal) config.terminal.commandTimeoutMs = value!; }} />
          <label class="st-switch st-row">
            <span class="st-switch-copy"><strong>{t("Notify when background commands finish")}</strong></span>
            <input type="checkbox" bind:checked={config.terminal.notifyOnExit} />
            <span class="st-switch-track" aria-hidden="true"></span>
          </label>
        </div>
      </div>
    {/if}
    <details class="st-details">
      <summary>{t("Advanced settings")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
      <div class="st-details-body">
        {#if config.terminal}
          <div class="st-group">
            <h3 class="st-group-title">{t("Background processes")}</h3>
            <div class="st-card">
              <SettingsNumber title={t("Background command time limit, min")} description={t("Leave blank to let the command run until it finishes or is stopped.")}
                value={config.terminal.jobTimeoutMs} scale={60_000} optional
                oninput={(value) => { if (config.terminal) config.terminal.jobTimeoutMs = value; }} />
              <SettingsNumber title={t("Terminal lines")} value={config.terminal.scrollback} max={100_000}
                oninput={(value) => { if (config.terminal) config.terminal.scrollback = value!; }} />
              <SettingsNumber title={t("Concurrent processes")} value={config.terminal.maxProcesses} max={4096}
                oninput={(value) => { if (config.terminal) config.terminal.maxProcesses = value!; }} />
              <SettingsNumber title={t("Process memory, MiB")} value={config.terminal.maxMemoryMb} max={1_048_576}
                oninput={(value) => { if (config.terminal) config.terminal.maxMemoryMb = value!; }} />
            </div>
          </div>
        {/if}
        <div class="st-group">
          <h3 class="st-group-title">{t("Tool results")}</h3>
          <div class="st-card">
            <SettingsNumber title={t("Output, bytes")} value={config.tools.maxOutputBytes}
              oninput={(value) => (config.tools.maxOutputBytes = value!)} />
            <SettingsNumber title={t("Output, lines")} value={config.tools.maxOutputLines}
              oninput={(value) => (config.tools.maxOutputLines = value!)} />
            <SettingsNumber title={t("Lines read per call")} value={config.tools.readLimitLines}
              oninput={(value) => (config.tools.readLimitLines = value!)} />
            <SettingsNumber title={t("bash wait time, s")} value={config.tools.bashTimeoutMs} scale={1000}
              oninput={(value) => (config.tools.bashTimeoutMs = value!)} />
          </div>
          <p class="st-group-note">{t("The agent receives shortened output. The full result is saved in the tool log.")}</p>
        </div>
      </div>
    </details>
  </section>
{/if}
