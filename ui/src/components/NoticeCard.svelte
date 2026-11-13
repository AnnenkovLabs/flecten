<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { continueTask } from "../lib/run/intents";
  import type { NoticeItem } from "../lib/types";
  import Icon from "./Icon.svelte";

  let { item }: { item: NoticeItem } = $props();
</script>

<div class="notice" class:is-warn={item.tone === "warn"} role="status">
  <Icon name={item.icon} size={14} />
  <div class="notice-body">
    <p class="notice-text">{item.text}</p>
    {#if item.meta}
      <p class="notice-meta">{item.meta}</p>
    {/if}
  </div>
  {#if item.action === "continue"}
    <button class="notice-btn" type="button" onclick={continueTask}>
      <Icon name="chevron-right" size={13} /> {t("Continue")} </button>
  {/if}
</div>

<style>
  .notice {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 68ch;
    margin-top: 16px;
    padding: 8px 10px 8px 12px;
    border-radius: 10px;
    background: rgba(240, 239, 237, 0.03);
    box-shadow: 0 0 0 1px var(--line);
    color: var(--text-2);
  }

  .notice.is-warn {
    background: rgba(211, 189, 145, 0.05);
    box-shadow: 0 0 0 1px rgba(211, 189, 145, 0.16);
  }

  .notice > :global(.icon) {
    flex: none;
    color: var(--muted);
  }

  .notice.is-warn > :global(.icon) {
    color: var(--warning);
  }

  .notice-body {
    flex: 1;
    min-width: 0;
  }

  .notice-text {
    margin: 0;
    overflow: hidden;
    font-size: 13px;
    line-height: 1.5;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notice-meta {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }

  .notice-btn {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 12px;
    border-radius: 8px;
    background: var(--raised);
    color: var(--text);
    font-size: 12.5px;
    transition:
      background 220ms var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .notice-btn:hover {
    border-radius: 10px;
    background: var(--raised-hover);
  }
</style>
