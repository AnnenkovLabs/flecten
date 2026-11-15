<script lang="ts">
  import type { MarketplaceEntry } from "../../../../shared/module-marketplace";
  import Icon from "../Icon.svelte";
  let { entry }: { entry: MarketplaceEntry } = $props();
</script>

<div class="product-preview" aria-hidden="true">
  <Icon name={entry.category === "workflow" ? "tasks" : entry.category === "interface" ? "panel-left" : "layers"} size={48} />
  <strong>{entry.title}</strong>
  <span>{entry.publisher}</span>
</div>

<style>
  .product-preview { aspect-ratio: 4 / 3; display: grid; place-content: center; justify-items: center; gap: var(--space-3); padding: var(--space-5); overflow: hidden; background: var(--surface); color: var(--text-2); border-radius: 10px; text-align: center; overflow-wrap: anywhere; }
  strong { font-size: 15px; font-weight: 500; }
  span { font-size: 12px; color: var(--muted); }
</style>
