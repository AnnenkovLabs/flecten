<script lang="ts">
  import { tick } from "svelte";
  import type { TerminalTabInfo } from "../../../../shared/terminal";
  import { t } from "../../lib/i18n.svelte";
  import type { TerminalStore } from "../../lib/terminal/store.svelte";
  import Icon from "../Icon.svelte";

  interface Props {
    store: TerminalStore;
  }

  let { store }: Props = $props();

  let editingId = $state<string | null>(null);
  let draftTitle = $state("");
  let editInput = $state<HTMLInputElement | null>(null);
  let railEl = $state<HTMLDivElement | null>(null);

  const userTabs = $derived(store.userTabs);
  const agentTabs = $derived(store.agentTabs);
  const showSections = $derived(userTabs.length > 0 && agentTabs.length > 0);

  function onWheel(event: WheelEvent): void {
    if (!railEl) return;
    if (railEl.scrollWidth <= railEl.clientWidth) return;
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      railEl.scrollLeft += event.deltaY;
    }
  }

  $effect(() => {
    const id = store.activeTab?.id;
    if (!id || !railEl) return;
    void tick().then(() => {
      railEl
        ?.querySelector<HTMLElement>('.term-tab-row.is-active')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  });

  function startRename(tab: TerminalTabInfo): void {
    editingId = tab.id;
    draftTitle = store.displayTitle(tab);
    void tick().then(() => {
      editInput?.focus();
      editInput?.select();
    });
  }

  function commitRename(tab: TerminalTabInfo): void {
    const next = draftTitle.trim();
    editingId = null;
    if (next && next !== tab.title) {
      void store.rename(tab.id, next);
    }
  }

  function cancelRename(): void {
    editingId = null;
  }

  function statusDotClass(tab: TerminalTabInfo): string {
    if (store.errors[tab.id]) return "is-error";
    if (!tab.running) return "is-exited";
    if (store.unreadIds[tab.id]) return "is-unread";
    return "";
  }

  function statusLabel(tab: TerminalTabInfo): string {
    if (!tab.running) {
      return tab.exitCode !== null
        ? t("Process exited with code {0}", [tab.exitCode])
        : t("Shell exited");
    }
    return tab.owner === "agent" ? t("Agent terminal") : tab.shellName;
  }

  function onListKeydown(event: KeyboardEvent): void {
    if (editingId) return;
    const all = store.tabs;
    if (all.length === 0) return;
    const index = all.findIndex((item) => item.id === store.activeId);
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = all[(index + 1) % all.length];
      if (next) store.select(next.id);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      const prev = all[(index - 1 + all.length) % all.length];
      if (prev) store.select(prev.id);
    }
  }
</script>

{#snippet tabRow(tab: TerminalTabInfo)}
  {@const active = tab.id === store.activeTab?.id}
  {@const label = store.displayTitle(tab)}
  <div
    class="term-tab-row"
    class:is-active={active}
    class:is-agent={tab.owner === "agent"}
    role="presentation"
  >
    {#if editingId === tab.id}
      <input
        bind:this={editInput}
        class="term-tab-rename"
        type="text"
        aria-label={t("Rename terminal")}
        value={draftTitle}
        oninput={(event) => (draftTitle = event.currentTarget.value)}
        onblur={() => commitRename(tab)}
        onkeydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitRename(tab);
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelRename();
          }
        }}
      />
    {:else}
      <button
        class="term-tab-select"
        type="button"
        role="tab"
        aria-selected={active}
        data-tooltip={`${label} (${statusLabel(tab)})`}
        onclick={() => store.select(tab.id)}
        ondblclick={() => startRename(tab)}
      >
        <span class="term-tab-icon" aria-hidden="true">
          <Icon name={tab.owner === "agent" ? "spark" : "terminal"} size={14} />
        </span>
        <span class="term-tab-label">{label}</span>
        <span class="term-tab-dot {statusDotClass(tab)}" aria-hidden="true"></span>
      </button>
      <button
        class="term-tab-close"
        type="button"
        aria-label={t("Close terminal")}
        data-tooltip={t("Close terminal")}
        onclick={(event) => {
          event.stopPropagation();
          void store.close(tab.id);
        }}
      >
        <Icon name="x" size={12} />
      </button>
    {/if}
  </div>
{/snippet}

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  class="term-rail"
  role="tablist"
  aria-label={t("Terminal tabs")}
  bind:this={railEl}
  onkeydown={onListKeydown}
  onwheel={onWheel}
>
  {#if showSections}
    <div class="term-rail-section">{t("Terminals")}</div>
  {/if}
  {#each userTabs as tab (tab.id)}
    {@render tabRow(tab)}
  {/each}

  {#if showSections}
    <div class="term-rail-section">{t("Agent terminals")}</div>
  {/if}
  {#each agentTabs as tab (tab.id)}
    {@render tabRow(tab)}
  {/each}
</div>
