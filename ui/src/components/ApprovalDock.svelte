<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { ApprovalItem, ThreadItem } from "../lib/types";
  import ApprovalCard from "./ApprovalCard.svelte";

  let { items }: { items: ThreadItem[] } = $props();
  const pending = $derived(items.filter((item): item is ApprovalItem => item.kind === "approval" && item.state === "pending"));
</script>

{#if pending.length > 0}
  <aside class="approval-dock" aria-label={t("Pending approvals")}>
    {#each pending as item (item.id)}<ApprovalCard {item} docked />{/each}
  </aside>
{/if}

<style>
  .approval-dock {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 10px;
    width: 100%;
    max-width: calc(var(--content-w) + 56px);
    max-height: 46dvh;
    margin-inline: auto;
    padding: 12px 28px 1px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
