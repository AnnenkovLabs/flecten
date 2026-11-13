<script module lang="ts">
  import type { WorkspaceSurface } from "../lib/workspace.svelte";

  export interface PanelTab {
    id: WorkspaceSurface;
    label: string;
    count?: number;
    avatar?: number;
    status?: string;
    state?: "running" | "succeeded" | "failed" | "stopped" | "interrupted";
  }
</script>

<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { onMount, tick } from "svelte";
  import SubagentAvatar from "./SubagentAvatar.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    tabs: PanelTab[];
    activeTab: WorkspaceSurface;
    hidden: boolean;
    onSelectTab: (tab: WorkspaceSurface) => void;
  }

  let { tabs, activeTab, hidden, onSelectTab }: Props = $props();

  let tabList: HTMLDivElement;
  let gooX = $state(0);
  let gooWidth = $state(0);
  let gooReady = $state(false);

  function measureTabs(): void {
    if (!tabList) return;
    const active = tabList.querySelector<HTMLElement>(`[data-tab="${activeTab}"]`);
    if (!active) {
      gooReady = false;
      return;
    }
    gooX = active.offsetLeft;
    gooWidth = active.offsetWidth;
    if (!gooReady) requestAnimationFrame(() => (gooReady = true));
  }

  $effect(() => {
    activeTab;
    hidden;
    tabs;
    void tick().then(measureTabs);
  });

  onMount(() => {
    const observer = new ResizeObserver(measureTabs);
    observer.observe(tabList);
    return () => observer.disconnect();
  });

  function onKeydown(event: KeyboardEvent, index: number): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;

    const tab = tabs[next];
    if (!tab) return;
    onSelectTab(tab.id);
    tick().then(() => {
      tabList.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
    });
  }
</script>

<header class="panel-head">
  <div
    class="panel-tabs"
    role="tablist"
    aria-label={t("Task workspace")}
    bind:this={tabList}
  >
    <span
      class="tab-goo"
      class:is-ready={gooReady}
      aria-hidden="true"
      style={`--goo-x: ${gooX}px; --goo-width: ${gooWidth}px`}
    >
      <span class="tab-goo-trail"></span>
      <span class="tab-goo-pill"></span>
    </span>
    {#each tabs as tab, index (tab.id)}
      <button
        class="panel-tab"
        class:is-active={activeTab === tab.id}
        id={`tab-${tab.id}`}
        data-tab={tab.id}
        type="button"
        role="tab"
        title={tab.status ? `${tab.label} · ${tab.status}` : tab.label}
        aria-selected={activeTab === tab.id}
        aria-controls={`pane-${tab.id}`}
        tabindex={activeTab === tab.id ? 0 : -1}
        onclick={() => onSelectTab(tab.id)}
        onkeydown={(event) => onKeydown(event, index)}
      >
        <span class="tab-label">
          {#if tab.avatar !== undefined}<SubagentAvatar variant={tab.avatar} size={26} />{/if}
          {tab.label}
          {#if tab.status}<span class="tab-status" aria-label={tab.status} data-state={tab.state}>
            {#if tab.state === "succeeded"}<Icon name="check" size={12} />{:else if tab.state === "failed" || tab.state === "interrupted"}<Icon name="x" size={12} />{:else if tab.state === "stopped"}<Icon name="stop" size={10} />{:else}·{/if}
          </span>{/if}
          {#if tab.count !== undefined && tab.count > 0}
            <span class="tab-count">{tab.count}</span>
          {/if}
        </span>
      </button>
    {/each}
  </div>
</header>

<style>
  .panel-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: calc(var(--control-h) + 8px);
    flex: 1;
    min-width: 0;
    padding: 0;
    overflow-x: auto;
    scrollbar-width: none;
    user-select: none;
  }

  .panel-tabs {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    min-height: calc(var(--control-h) + 8px);
  }

  .tab-goo {
    position: absolute;
    inset: 0;
    z-index: 0;
    opacity: 0;
    pointer-events: none;
    filter: url(#goo);
    transition: opacity 240ms var(--ease);
  }

  .tab-goo.is-ready {
    opacity: 1;
  }

  .tab-goo:not(.is-ready) .tab-goo-pill,
  .tab-goo:not(.is-ready) .tab-goo-trail {
    transition: none;
  }

  .tab-goo-pill,
  .tab-goo-trail {
    position: absolute;
    top: 50%;
    left: var(--goo-x);
    width: var(--goo-width);
    height: var(--control-sm-h);
    translate: 0 -50%;
    border-radius: 999px;
    background: var(--raised);
    transition:
      left 480ms var(--ease-jelly),
      width 480ms var(--ease-jelly);
  }

  .tab-goo-trail {
    transition:
      left 720ms var(--ease-goo),
      width 720ms var(--ease-goo);
  }

  .panel-tab {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    min-height: calc(var(--control-h) + 8px);
    padding: 0 var(--space-3);
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    transition: color 320ms var(--ease);
  }

  .tab-label {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 0;
    border-radius: 4px;
  }

  .panel-tab:focus-visible {
    outline: none;
  }

  .panel-tab:focus-visible .tab-label {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .panel-tab:hover {
    color: var(--text-2);
  }

  .panel-tab.is-active {
    color: var(--text);
  }

  .tab-count {
    display: inline-block;
    flex: none;
    min-width: 1ch;
    color: var(--muted);
    font-size: 12px;
    font-weight: 400;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .tab-status { color: var(--primary); font-weight: 800; }
  .tab-status[data-state="failed"], .tab-status[data-state="interrupted"] { color: var(--error); }
  .tab-status[data-state="stopped"] { color: var(--muted); }
  .tab-status[data-state="succeeded"] { color: var(--success); }

  .panel-tab.is-active .tab-count {
    color: var(--primary);
  }

  @media (prefers-reduced-motion: reduce) {
    .tab-goo,
    .tab-goo-pill,
    .tab-goo-trail,
    .panel-tab {
      transition: none;
    }
  }
</style>
