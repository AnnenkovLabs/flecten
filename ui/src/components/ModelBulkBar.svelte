<script lang="ts">
  import { t } from "../lib/i18n.svelte";

  interface Props {
    count: number;
    canDelete: boolean;
    providerName: string;
    onenable: (disabled: boolean) => void;
    ondelete: () => void;
    onclear: () => void;
  }

  let { count, canDelete, providerName, onenable, ondelete, onclear }: Props = $props();

  let confirming = $state(false);
</script>

<div class="bulk-bar" role="status">
  <span class="bulk-count">{t("Selected: {0}", [count])}</span>
  <button class="st-btn st-btn--quiet st-btn--sm" type="button" onclick={() => onenable(false)}> {t("Enable")} </button>
  <button class="st-btn st-btn--quiet st-btn--sm" type="button" onclick={() => onenable(true)}> {t("Hide")} </button>
  <button
    class="st-btn st-btn--danger st-btn--sm"
    type="button"
    disabled={!canDelete}
    title={canDelete ? t("Delete selected models") : t("Cannot delete all models")}
    onclick={() => (confirming = true)}
  > {t("Delete")} </button>
  <button class="st-btn st-btn--quiet st-btn--sm" type="button" onclick={onclear}> {t("Clear selection")} </button>
</div>
{#if !canDelete}
  <span class="st-hint">{t("Keep at least one model for this provider.")}</span>
{/if}

{#if confirming}
  <div class="st-confirm bulk-confirm" role="alert">
    <span> {t("Delete the selected models from “{0}”? This change takes effect after you save settings.", [providerName])} </span>
    <div class="st-confirm-actions">
      <button class="st-btn st-btn--quiet st-btn--sm" type="button" onclick={() => (confirming = false)}> {t("Cancel")} </button>
      <button class="st-btn st-btn--danger st-btn--sm" type="button" onclick={ondelete}>
        {count === 1 ? t("Delete model") : t("Delete models")}
      </button>
    </div>
  </div>
{/if}

<style>
  .bulk-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--primary) 7%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 18%, transparent);
  }

  .bulk-count {
    color: var(--text-2);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .bulk-confirm {
    align-items: flex-start;
  }

  @media (max-width: 900px) {
    .bulk-bar {
      gap: 6px;
    }
  }
</style>
