<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { tick } from "svelte";
  import { formatDuration } from "../lib/agent";
  import { expandable } from "../lib/motion";
  import { reasoningPreviewLine } from "../lib/run/worker-mirrors";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";

  interface Props {
    text: string;
    streaming: boolean;
    startedAt?: number | undefined;
    reasoningMs?: number | undefined;
    livePreview?: boolean | undefined;
  }

  let { text, streaming, startedAt, reasoningMs, livePreview = false }: Props = $props();
  const uid = $props.id();
  const bodyId = `reasoning-body-${uid}`;

  let open = $state(false);
  let userToggled = $state(false);
  let viewport = $state<HTMLDivElement | null>(null);
  let now = $state(Date.now());

  const expanded = $derived(userToggled ? open : (livePreview && streaming) || open);
  const liveDuration = $derived(
    streaming && startedAt !== undefined
      ? formatDuration(Math.max(0, now - startedAt))
      : "",
  );
  const duration = $derived(
    reasoningMs === undefined ? "" : formatDuration(reasoningMs),
  );
  const previewLine = $derived(streaming && !expanded ? reasoningPreviewLine(text) : "");

  $effect(() => {
    if (!streaming || startedAt === undefined) return;
    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    text;
    if (!streaming || !viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  });

  function toggle(): void {
    userToggled = true;
    open = !expanded;
    if (!open) return;
    void tick().then(() => viewport?.scrollTo({ top: 0 }));
  }
</script>

<div class="reasoning">
  <button
    class="reasoning-head"
    type="button"
    aria-expanded={expanded}
    aria-controls={bodyId}
    data-tooltip={expanded ? t("Hide reasoning") : t("Show reasoning")}
    onclick={toggle}
  >
    <span>{streaming ? t("Thinking") : duration ? t("Thought for {0}", [duration]) : t("Reasoning")}</span>
    {#if liveDuration}
      <span class="reasoning-time">{liveDuration}</span>
    {/if}
    <span class="chevron" class:is-open={expanded}><Icon name="chevron-right" size={12} /></span>
  </button>

  {#if previewLine}
    <p class="reasoning-preview">{previewLine}</p>
  {/if}

  <div class="reasoning-body" id={bodyId} use:expandable={expanded}>
    <div class="viewport" class:is-streaming={streaming} bind:this={viewport}>
      <Markdown {text} />
    </div>
  </div>
</div>

<style>
  .reasoning {
    position: relative;
    isolation: isolate;
    margin: 2px 0 5px;
    min-width: 0;
  }

  .reasoning-head {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    margin-left: -7px;
    padding: 0 7px;
    border-radius: 6px;
    color: var(--muted);
    font-size: 12.5px;
    line-height: 1;
    transition:
      background 180ms var(--ease),
      color 180ms var(--ease);
  }

  button.reasoning-head:hover {
    background: rgba(240, 239, 237, 0.035);
    color: var(--text-2);
  }

  button.reasoning-head:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }

  .reasoning-time {
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    opacity: 0.78;
  }

  .reasoning-preview {
    margin: 2px 0 4px 18px;
    overflow: hidden;
    color: var(--muted);
    font-size: calc(12.5px * var(--text-scale, 1));
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.82;
  }

  .chevron {
    display: grid;
    place-items: center;
    transition: transform 180ms var(--ease);
  }

  .chevron.is-open {
    transform: rotate(90deg);
  }

  .reasoning-body {
    min-width: 0;
  }

  .viewport {
    max-height: 160px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 10px 0 10px 18px;
    color: var(--muted);
    font-size: calc(13px * var(--text-scale, 1));
    line-height: 1.6;
    mask-image: linear-gradient(
      to bottom,
      transparent,
      black 10px,
      black calc(100% - 10px),
      transparent
    );
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent,
      black 10px,
      black calc(100% - 10px),
      transparent
    );
  }

  .viewport.is-streaming {
    overflow-y: hidden;
    mask-image: linear-gradient(to bottom, transparent, black 10px);
    -webkit-mask-image: linear-gradient(to bottom, transparent, black 10px);
  }

  .viewport :global(.markdown) {
    max-width: none;
    background: transparent;
    color: var(--muted);
    font-size: calc(13px * var(--text-scale, 1));
    line-height: 1.6;
  }

  .viewport :global(.markdown > :last-child) {
    margin-bottom: 0;
  }

  .viewport :global(.markdown h1),
  .viewport :global(.markdown h2),
  .viewport :global(.markdown h3),
  .viewport :global(.markdown h4),
  .viewport :global(.markdown h5),
  .viewport :global(.markdown h6) {
    margin: 12px 0 6px;
    color: var(--text-2);
    font-size: calc(14px * var(--text-scale, 1));
    line-height: 1.3;
  }

  .viewport :global(.markdown strong) {
    color: var(--text-2);
  }

  .viewport :global(.markdown code) {
    padding: 1px 4px;
    background: rgba(240, 239, 237, 0.06);
    color: var(--text-2);
    font-size: 0.92em;
  }

  .viewport :global(.markdown pre) {
    padding: 8px 10px;
    background: var(--surface);
  }

  .viewport :global(.markdown pre code) {
    font-size: calc(var(--code-font-size, 13px) - 1px);
  }

  .viewport :global(.markdown .code-block) {
    margin-bottom: 8px;
    background: var(--surface);
  }

  .viewport :global(.markdown .code-head) {
    min-height: 28px;
    padding: 2px 6px 2px 8px;
  }

  .viewport :global(.markdown .code-lang) {
    font-size: 12px;
  }

  .viewport :global(.markdown .code-block pre) {
    padding: 6px 8px;
  }

  .viewport :global(.markdown table) {
    margin: 8px 0;
  }

  .viewport :global(.markdown th),
  .viewport :global(.markdown td) {
    padding: 4px 8px;
  }

  .viewport :global(.markdown a) {
    color: var(--text-2);
  }
</style>
