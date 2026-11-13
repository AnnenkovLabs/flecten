<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    description?: string;
    stacked?: boolean;
    children?: Snippet;
  }

  let { title, description = "", stacked = false, children }: Props = $props();
</script>

<label class="st-row" class:st-row--stacked={stacked}>
  <div class="st-row-copy">
    <span class="st-row-title">{title}</span>
    {#if description}
      <span class="st-row-desc">{description}</span>
    {/if}
  </div>
  {#if children}
    <div class="st-row-control">{@render children()}</div>
  {/if}
</label>