<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { ProviderSettings } from "../lib/types";

  let { provider }: { provider: ProviderSettings } = $props();
  const id = $props.id();

  function setEnabled(enabled: boolean): void {
    provider.modelAutoRefresh = {
      enabled,
      overwriteManual: provider.modelAutoRefresh?.overwriteManual ?? false,
    };
  }
</script>

<div class="model-refresh">
  <label class="st-switch">
    <span class="st-switch-copy">
      <strong id={`${id}-label`}>{t("Refresh models every hour")}</strong>
      <span id={`${id}-hint`}>{t("Update all models and their capabilities while the app is open. Manual edits are kept by default.")}</span>
    </span>
    <input
      type="checkbox"
      role="switch"
      checked={provider.modelAutoRefresh?.enabled ?? false}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      onchange={(event) => setEnabled(event.currentTarget.checked)}
    />
    <span class="st-switch-track" aria-hidden="true"></span>
  </label>
  {#if provider.modelAutoRefresh?.enabled}
    <label class="manual-edits">
      <input
        type="checkbox"
        checked={provider.modelAutoRefresh.overwriteManual}
        aria-labelledby={`${id}-manual-label`}
        aria-describedby={`${id}-manual-hint`}
        onchange={(event) => {
          provider.modelAutoRefresh = { enabled: true, overwriteManual: event.currentTarget.checked };
        }}
      />
      <span class="st-switch-copy">
        <strong id={`${id}-manual-label`}>{t("Overwrite manual model edits")}</strong>
        <span id={`${id}-manual-hint`}>{t("Allow automatic updates to replace model details you changed manually.")}</span>
      </span>
    </label>
  {/if}
</div>

<style>
  .model-refresh {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-block-end: 8px;
  }

  .manual-edits {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-height: 40px;
    margin-inline-start: 16px;
    cursor: pointer;
  }

  .manual-edits input {
    width: 16px;
    height: 16px;
    flex: none;
    margin: 1px 0 0;
    accent-color: var(--primary);
  }
</style>
