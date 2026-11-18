<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import { slide } from "svelte/transition";
  import { prefersReducedMotion } from "../lib/motion";
  import { revealSidebarChats } from "../lib/sidebar-chat-motion";

  let { id, open, searching, children }: {
    id: string; open: boolean; searching: boolean; children: Snippet;
  } = $props();

  let stop: (() => void) | undefined;
  let wasClosed = false;
  $effect.pre(() => {
    if (searching) wasClosed = false;
    else if (!open) wasClosed = true;
  });

  function end(): void {
    stop?.();
    stop = undefined;
  }

  function start(event: Event): void {
    end();
    const eligible = wasClosed;
    wasClosed = false;
    if (!searching && !prefersReducedMotion() && event.currentTarget instanceof HTMLElement) {
      stop = revealSidebarChats(event.currentTarget, eligible);
    }
  }

  function reveal(node: HTMLElement) {
    return slide(node, { duration: searching || prefersReducedMotion() ? 0 : open ? 220 : 150 });
  }

  $effect(() => {
    if (searching || !open) end();
  });

  onDestroy(end);
</script>

<div {id} inert={!open}>
  {#if open}
    <div
      class="chat-drawer"
      transition:reveal
      onintrostart={start}
      onoutrostart={end}
    >
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .chat-drawer:global([data-chat-reveal]) { overflow: clip; }
  .chat-drawer:global([data-chat-reveal="rescue"]) { position: relative; }
  .chat-drawer :global([data-rescue-card="waiting"]) { visibility: hidden; opacity: 0; }
  .chat-drawer :global([data-rescue-card="stack"]) { transform: translateY(var(--stack-shift)); }
  .chat-drawer :global([data-rescue-card="pull"]) {
    transform-origin: center;
    z-index: 2;
    background: color-mix(in srgb, var(--raised) var(--card-cover), transparent);
  }

  .chat-drawer :global(.sidebar-rescue-stage) {
    position: absolute;
    z-index: 3;
    left: 0;
    top: 0;
    pointer-events: none;
  }
</style>
