<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { onMount, tick } from "svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    query: string;
    index: number;
    count: number;
    /** Changes when Ctrl+F is pressed again: the field takes focus and selects its text. */
    focusToken: number;
    onClose: () => void;
  }

  let { query = $bindable(), index = $bindable(), count, focusToken, onClose }: Props = $props();
  let input = $state<HTMLInputElement | undefined>(undefined);
  const label = $derived(count === 0 ? t("none") : t("{0} of {1}", [index + 1, count]));

  function focus(): void {
    void tick().then(() => {
      input?.focus();
      input?.select();
    });
  }

  function step(delta: number): void {
    if (count === 0) return;
    index = (index + delta + count) % count;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.key !== "Enter") return;
    event.preventDefault();
    step(event.shiftKey ? -1 : 1);
  }

  onMount(focus);

  $effect(() => {
    focusToken;
    focus();
  });
</script>

<div class="thread-search" role="search">
  <Icon name="search" size={14} />
  <input
    bind:this={input}
    bind:value={query}
    type="text"
    placeholder={t("Search conversation")}
    aria-label={t("Search conversation")}
    oninput={() => (index = 0)}
    onkeydown={onKeydown}
  />
  <span class="search-count" aria-live="polite">{label}</span>
  <button
    class="search-btn is-prev"
    type="button"
    aria-label={t("Previous match")}
    title={t("Previous match")}
    disabled={count === 0}
    onclick={() => step(-1)}
  >
    <Icon name="chevron-right" size={14} />
  </button>
  <button
    class="search-btn is-next"
    type="button"
    aria-label={t("Next match")}
    title={t("Next match")}
    disabled={count === 0}
    onclick={() => step(1)}
  >
    <Icon name="chevron-right" size={14} />
  </button>
  <button class="search-btn" type="button" aria-label={t("Close search")} title={t("Close search")} onclick={onClose}>
    <Icon name="x" size={14} />
  </button>
</div>

<style>
  .thread-search {
    position: sticky;
    top: 12px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 4px;
    width: min(720px, calc(100% - 44px));
    height: 48px;
    margin: 12px auto -60px;
    padding: 0 4px 0 12px;
    border-radius: 12px;
    background: var(--surface);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.07),
      0 8px 24px rgba(0, 0, 0, 0.35),
      inset 0 1px 0 rgba(240, 239, 237, 0.06);
  }

  .thread-search :global(.icon) {
    color: var(--muted);
  }

  .thread-search input {
    flex: 1;
    min-width: 0;
    height: 40px;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font-size: 13px;
  }

  .thread-search input::placeholder {
    color: var(--muted);
  }

  .search-count {
    min-width: 44px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.3;
    text-align: right;
    white-space: nowrap;
  }

  .search-btn {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 7px;
    color: var(--muted);
    transition:
      background 220ms var(--ease),
      color 220ms var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .search-btn:hover:not(:disabled) {
    border-radius: 10px;
    background: rgba(240, 239, 237, 0.05);
    color: var(--text-2);
  }

  .search-btn:disabled {
    opacity: 0.35;
  }

  .search-btn.is-prev :global(.icon) {
    transform: rotate(-90deg);
  }

  .search-btn.is-next :global(.icon) {
    transform: rotate(90deg);
  }

  @media (max-width: 1220px) {
    .thread-search {
      width: calc(100% - 44px);
    }
  }
</style>
