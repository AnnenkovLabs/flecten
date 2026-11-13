<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { WorkerItem } from "../lib/types";
  import WorkerActivity from "./WorkerActivity.svelte";
  let { items }: { items: WorkerItem[] } = $props();
</script>

<div class="worker-pane">
  {#if items.length === 0}<p class="empty">{t("No tool calls yet")}</p>{/if}
  {#each items as item (item.id)}<WorkerActivity {item} />{/each}
</div>

<style>
  .worker-pane { padding: 0 20px 24px; min-width: 0; }
  .empty { padding-block: 48px; color: var(--muted); text-align: center; font-size: 14px; }
</style>
