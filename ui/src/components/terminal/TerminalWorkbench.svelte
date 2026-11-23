<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "../../lib/i18n.svelte";
  import { modLabel } from "../../lib/platform";
  import type { TerminalStore } from "../../lib/terminal/store.svelte";
  import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from "../../lib/terminal/xterm-config";
  import type { TerminalLine } from "../../lib/types";
  import Icon from "../Icon.svelte";
  import TerminalPane from "../TerminalPane.svelte";
  import TerminalTabsRail from "./TerminalTabsRail.svelte";
  import TerminalViewport from "./TerminalViewport.svelte";
  import "./terminal.css";
  import "./terminal-viewport.css";

  interface Props {
    store: TerminalStore;
    visible: boolean;
    commandLines?: TerminalLine[];
    showHide?: boolean;
    onHide?: (() => void) | undefined;
    onOpenFile?: ((path: string, line?: number, column?: number) => void) | undefined;
  }

  let {
    store,
    visible,
    commandLines = [],
    showHide = false,
    onHide,
    onOpenFile,
  }: Props = $props();

  let stageEl = $state<HTMLDivElement | null>(null);
  let profileMenu = $state<{ x: number; y: number } | null>(null);
  let findToken = $state(0);

  const activeTab = $derived(store.activeTab);
  const hasCommands = $derived(commandLines.length > 0);
  const showingCommands = $derived(store.view === "commands" && hasCommands);

  function estimatedGrid(): { cols: number; rows: number } {
    const width = stageEl?.clientWidth ?? 800;
    const height = stageEl?.clientHeight ?? 280;
    const charW = Math.max(6, store.fontSize * 0.61);
    const charH = Math.max(12, store.fontSize * 1.28);
    return {
      cols: Math.max(40, Math.min(300, Math.floor((width - 24) / charW))),
      rows: Math.max(8, Math.min(120, Math.floor((height - 16) / charH))),
    };
  }

  async function createTab(shell?: string): Promise<void> {
    profileMenu = null;
    const { cols, rows } = estimatedGrid();
    await store.create({ ...(shell ? { shell } : {}), cols, rows });
  }

  function toggleProfiles(event: MouseEvent): void {
    event.stopPropagation();
    if (profileMenu) {
      profileMenu = null;
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.max(8, Math.min(rect.right - 200, window.innerWidth - 216));
    const y = Math.min(rect.bottom + 4, window.innerHeight - 200);
    profileMenu = { x, y };
  }

  $effect(() => {
    if (visible && !showingCommands) {
      const { cols, rows } = estimatedGrid();
      void store.ensureReady(cols, rows);
    }
  });

  onMount(() => {
    const dismiss = (): void => {
      profileMenu = null;
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  });
</script>

<div class="term-workbench">
  <header class="term-header">
    <div class="term-header-left">
      {#if hasCommands}
        <div class="term-mode-tabs" role="tablist" aria-label={t("Terminal view")}>
          <button
            class="term-mode-tab"
            type="button"
            role="tab"
            aria-selected={!showingCommands}
            onclick={() => (store.view = "terminals")}
          >
            <Icon name="terminal" size={13} />
            <span>{t("Terminals")}</span>
            {#if store.tabs.length > 0}
              <span class="term-mode-count">{store.tabs.length}</span>
            {/if}
          </button>
          <button
            class="term-mode-tab"
            type="button"
            role="tab"
            aria-selected={showingCommands}
            onclick={() => (store.view = "commands")}
          >
            <span>{t("Command log")}</span>
          </button>
        </div>
      {/if}

      {#if !showingCommands && activeTab}
        <div class="term-active-meta" data-tooltip={activeTab.cwd}>
          {#if !hasCommands}
            <Icon name={activeTab.owner === "agent" ? "spark" : "terminal"} size={14} />
          {/if}
          <span class="term-active-title">{store.displayTitle(activeTab)}</span>
          {#if activeTab.owner === "agent"}
            <span class="term-badge is-agent">{t("Agent PTY")}</span>
          {/if}
          {#if !activeTab.running}
            <span class="term-badge is-exited">{t("Exited")}</span>
          {/if}
        </div>
      {/if}
    </div>

    <div class="term-header-actions">
      <div class="term-split-create">
        <button
          class="term-icon-btn"
          type="button"
          aria-label={t("New terminal")}
          data-tooltip={t("New terminal ({0}+Shift+`)", [modLabel])}
          onclick={() => void createTab()}
        >
          <Icon name="plus" size={14} />
        </button>
        {#if store.profiles.length > 1}
          <button
            class="term-icon-btn term-profile-chevron"
            type="button"
            aria-label={t("Select shell profile")}
            data-tooltip={t("Select shell profile")}
            aria-expanded={profileMenu !== null}
            onclick={toggleProfiles}
          >
            <Icon name="chevron-down" size={12} />
          </button>
        {/if}
      </div>

      {#if !showingCommands && activeTab}
        <span class="term-sep" aria-hidden="true"></span>
        <button
          class="term-icon-btn"
          type="button"
          aria-label={t("Find in terminal")}
          data-tooltip={t("Find in terminal ({0}+F)", [modLabel])}
          onclick={() => (findToken += 1)}
        >
          <Icon name="search" size={14} />
        </button>
        <button
          class="term-icon-btn"
          type="button"
          disabled={store.fontSize <= MIN_TERMINAL_FONT_SIZE}
          aria-label={t("Decrease terminal font size")}
          data-tooltip={t("Decrease terminal font size")}
          onclick={() => store.zoom(-1)}
        >
          A-
        </button>
        <button
          class="term-icon-btn"
          type="button"
          disabled={store.fontSize >= MAX_TERMINAL_FONT_SIZE}
          aria-label={t("Increase terminal font size")}
          data-tooltip={t("Increase terminal font size")}
          onclick={() => store.zoom(1)}
        >
          A+
        </button>
        <button
          class="term-icon-btn"
          type="button"
          aria-label={t("Clear terminal")}
          data-tooltip={t("Clear terminal")}
          onclick={() => store.clear(activeTab.id)}
        >
          <Icon name="edit" size={13} />
        </button>
        {#if activeTab.owner === "user"}
          <button
            class="term-icon-btn"
            type="button"
            aria-label={t("Restart terminal")}
            data-tooltip={t("Restart terminal")}
            onclick={() => void store.restart(activeTab.id)}
          >
            <Icon name="refresh" size={14} />
          </button>
        {:else if activeTab.running}
          <button
            class="term-icon-btn"
            type="button"
            aria-label={t("Stop terminal")}
            data-tooltip={t("Stop terminal")}
            onclick={() => void store.stop(activeTab.id)}
          >
            <Icon name="stop" size={14} />
          </button>
        {/if}
        <button
          class="term-icon-btn"
          type="button"
          aria-label={t("Close terminal")}
          data-tooltip={t("Close terminal")}
          onclick={() => void store.close(activeTab.id)}
        >
          <Icon name="trash" size={14} />
        </button>
        <button
          class="term-icon-btn term-rail-toggle"
          type="button"
          aria-pressed={store.railOpen}
          aria-label={t("Toggle terminal tabs")}
          data-tooltip={t("Toggle terminal tabs")}
          onclick={() => store.toggleRail()}
        >
          <Icon name="panel-right" size={14} />
        </button>
      {/if}

      {#if showHide && onHide}
        <span class="term-sep" aria-hidden="true"></span>
        <button
          class="term-icon-btn"
          type="button"
          aria-label={t("Hide terminal")}
          data-tooltip={t("Hide terminal")}
          onclick={onHide}
        >
          <Icon name="x" size={14} />
        </button>
      {/if}
    </div>
  </header>

  {#if showingCommands}
    <div class="term-stage">
      <TerminalPane lines={commandLines} />
    </div>
  {:else}
    <div class="term-body">
      <div class="term-stage" bind:this={stageEl}>
        {#if store.tabs.length === 0}
          <div class="term-empty-state">
            <span>{store.loading ? t("Starting terminal…") : t("No open terminals")}</span>
            {#if !store.loading}
              <button class="term-empty-btn" type="button" onclick={() => void createTab()}>
                <Icon name="plus" size={14} /> {t("New terminal")}
              </button>
            {/if}
          </div>
        {:else}
          {#each store.tabs as tab (tab.id)}
            <TerminalViewport
              {store}
              {tab}
              active={visible && !showingCommands && tab.id === activeTab?.id}
              {findToken}
              {onOpenFile}
              onNewTab={() => void createTab()}
            />
          {/each}
        {/if}
      </div>

      {#if store.railOpen && store.tabs.length > 0}
        <TerminalTabsRail {store} />
      {/if}
    </div>
  {/if}

  {#if profileMenu}
    <div
      class="term-menu"
      role="menu"
      tabindex="-1"
      aria-label={t("Select shell profile")}
      style:left={`${profileMenu.x}px`}
      style:top={`${profileMenu.y}px`}
      onpointerdown={(event) => event.stopPropagation()}
    >
      {#each store.profiles as profile (profile.id)}
        <button
          class="term-menu-item"
          type="button"
          role="menuitem"
          onclick={() => void createTab(profile.shell)}
        >
          <span>{profile.label}</span>
          {#if profile.isDefault}
            <kbd>{t("Default")}</kbd>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
