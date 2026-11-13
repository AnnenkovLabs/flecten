<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { stopWorker } from "../lib/run/intents";
  import type { WorkerItem } from "../lib/types";
  import RunActionRow from "./RunActionRow.svelte";
  let { item }: { item: WorkerItem } = $props();
  let expanded = $state(true);
  const status = $derived({ running: t("Working"), done: t("Done"), stopped: t("Stopped"), error: t("Error"), interrupted: t("Interrupted") }[item.status]);
</script>

<section class="worker-activity" aria-label={t("Worker activity")}>
  <div class="worker-heading">
    <button type="button" class="worker-toggle" aria-expanded={expanded} onclick={() => expanded = !expanded}>
      <span>Worker</span><span class="worker-status">{status} · {item.actions.length}</span>
    </button>
    {#if item.status === "running"}<button type="button" class="worker-stop" onclick={stopWorker}>{t("Stop Worker")}</button>{/if}
  </div>
  {#if expanded}
    {#each item.actions as action (action.id)}<RunActionRow {action} />{/each}
  {/if}
</section>

<style>
  .worker-activity { min-width: 0; margin-top: 16px; border-block: 1px solid var(--line); padding-block: 8px; }
  .worker-heading { display: flex; align-items: center; gap: 12px; }
  .worker-toggle { display: flex; flex: 1; gap: 12px; align-items: center; min-height: 40px; font-size: 12.5px; text-align: left; }
  .worker-status { color: var(--muted); font-variant-numeric: tabular-nums; }
  .worker-stop { min-height: 40px; color: var(--error); font-size: 12px; }
  button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
</style>
