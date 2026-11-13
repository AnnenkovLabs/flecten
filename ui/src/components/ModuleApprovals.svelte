<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { ApprovalItem, ThreadItem } from "../lib/types";
  import ApprovalCard from "./ApprovalCard.svelte";

  let { items }: { items: ThreadItem[] } = $props();
  const pending = $derived(items.filter((item): item is ApprovalItem => item.kind === "approval" && item.state === "pending"));
</script>

{#if pending.length}
  <section class="module-approvals" aria-label={t("Awaiting approval")}>
    {#each pending as item (item.id)}<ApprovalCard {item} />{/each}
  </section>
{/if}

<style>
  .module-approvals { flex: none; max-height: 45vh; overflow: auto; padding: 12px 16px; }
</style>
