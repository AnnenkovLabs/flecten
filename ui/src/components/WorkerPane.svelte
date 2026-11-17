<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { stopWorker } from "../lib/run/intents";
  import type { WorkerView } from "../lib/run/worker.svelte";
  import type { SummaryDestination } from "../lib/markdown/summary-navigation";
  import ApprovalDock from "./ApprovalDock.svelte";
  import Icon from "./Icon.svelte";
  import Thread from "./Thread.svelte";
  import WorkerAcceptance from "./WorkerAcceptance.svelte";
  let { taskId, worker, onOpenChanges, onNavigateSummary }: {
    taskId: string;
    worker: WorkerView;
    onOpenChanges: () => void;
    onNavigateSummary: (destination: SummaryDestination) => void;
  } = $props();
  const latest = $derived(worker.items.at(-1));
</script>

<section class="worker-pane worker-activity" aria-label={t("Worker activity")}>
  <div class="worker-heading">
    <span>Worker</span>
    {#if !worker.running && latest}<span class="worker-status" role="status">{worker.liveLabel}</span>{/if}
    {#if worker.running}
      <button type="button" class="worker-stop" onclick={stopWorker}>
        <Icon name="stop" size={14} />{t("Stop Worker")}
      </button>
    {/if}
  </div>
  {#if latest}
  <Thread
    taskId={`${taskId}:worker`}
    items={worker.transcript.items}
    live={worker.running}
    busy={worker.running}
    historyDisabled={true}
    liveLabel={worker.liveLabel}
    retryUntil={worker.retryUntil}
    pendingCalls={worker.transcript.pendingCalls}
    {onOpenChanges}
    {onNavigateSummary}
  >
    {#snippet header()}
      {#each worker.items as item (item.id)}
        {#if item.acceptance}<WorkerAcceptance acceptance={item.acceptance} />{/if}
      {/each}
    {/snippet}
  </Thread>
  <ApprovalDock items={worker.transcript.items} />
  {:else}<p class="empty">{t("Worker has not started yet")}</p>{/if}
</section>

<style>
  .worker-pane { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); }
  .worker-heading { display: flex; flex: none; align-items: center; gap: 12px; min-height: var(--control-h); padding: 12px 28px 0; color: var(--text-2); font-size: 13px; }
  .worker-status { color: var(--muted); }
  .worker-stop { display: inline-flex; align-items: center; gap: 7px; margin-left: auto; min-height: var(--control-h); padding: 0 10px; border-radius: 6px; background: var(--surface); color: var(--error); font-size: 12px; }
  .worker-stop:hover { background: var(--raised); }
  .worker-stop:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .empty { padding-block: 48px; color: var(--muted); text-align: center; font-size: 14px; }
  @media (max-width: 1220px) { .worker-heading { padding-inline: 22px; } }
</style>
