<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { canContinue, errorReason } from "../lib/run-errors";
  import type { ErrorItem } from "../lib/run-errors";
  import Icon from "./Icon.svelte";

  let { item, onRepeat }: { item: ErrorItem; onRepeat: (prompt?: string) => void } = $props();
</script>

  <div class="error-card" role="alert">
    <div class="error-head">
      <Icon name="x" size={15} stroke={2} />
      <p>{errorReason(item)}</p>
    </div>
    <details>
      <summary>{t("Details")}</summary>
      <pre>{item.text || t("No details")}</pre>
    </details>
    {#if canContinue(item)}
      <button class="error-retry" type="button" onclick={() => onRepeat("/continue")}>
        <Icon name="chevron-right" size={14} /> {t("Continue")} </button>
    {:else}
      <button class="error-retry" type="button" onclick={() => onRepeat()}>
        <Icon name="refresh" size={14} /> {t("Retry")} </button>
    {/if}
  </div>

<style>
  .error-card {
    max-width: 68ch;
    margin-top: 24px;
    padding: 12px 14px;
    border-radius: 10px;
    background: rgba(226, 162, 162, 0.07);
    box-shadow:
      inset 0 1px 0 rgba(240, 239, 237, 0.04),
      0 0 0 1px rgba(226, 162, 162, 0.14);
  }

  .error-head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: #d9a096;
    font-size: 13.5px;
    line-height: 1.55;
    text-wrap: pretty;
  }

  .error-head :global(.icon) {
    margin-top: 2px;
    color: var(--error);
  }

  .error-card details {
    margin-top: 8px;
    color: var(--muted);
    font-size: 12px;
  }

  .error-card summary {
    display: flex;
    align-items: center;
    min-height: 40px;
    margin: -10px 0 0;
    padding: 10px 0;
    color: var(--text-2);
    cursor: pointer;
  }

  .error-card pre {
    max-height: 200px;
    margin: 0 0 4px;
    overflow: auto;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .error-retry {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 40px;
    margin-top: 10px;
    padding: 0 12px;
    border-radius: 8px;
    background: var(--raised);
    color: var(--text-2);
    font-size: 12.5px;
    transition:
      background 220ms var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .error-retry:hover {
    border-radius: 10px;
    background: var(--raised-hover);
    color: var(--text);
  }
</style>
