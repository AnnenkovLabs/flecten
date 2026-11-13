<script lang="ts">
  import { toolReferences } from "../lib/markdown/tool-references";
  import type { RunAction } from "../lib/types";
  import Markdown from "./Markdown.svelte";
  import RunActionRow from "./RunActionRow.svelte";
  let { text, tools = new Map() }: { text: string; tools?: ReadonlyMap<string, RunAction> } = $props();
  const parts = $derived(toolReferences(text, new Set(tools.keys())));
</script>

{#each parts as part, index (index)}
  {#if part.kind === "markdown"}<Markdown text={part.text} />
  {:else}
    {@const action = tools.get(part.id)}
    {#if action}<div class="tool-mirror" data-tool-reference={part.id}><RunActionRow {action} /></div>{/if}
  {/if}
{/each}

<style>
  .tool-mirror { margin-block: 2px; font-size: 12.5px; text-wrap: wrap; }
</style>
