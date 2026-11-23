<script lang="ts">
  import { tick } from "svelte";
  import type { TerminalTabInfo } from "../../../../shared/terminal";
  import { t } from "../../lib/i18n.svelte";
  import { macPlatform, modLabel } from "../../lib/platform";
  import Icon from "../Icon.svelte";

  interface Props {
    tab: TerminalTabInfo;
    findOpen: boolean;
    findQuery: string;
    findCase: boolean;
    matchCount: number;
    matchIndex: number;
    contextMenu: { x: number; y: number } | null;
    hasSelection: boolean;
    onFindQuery: (value: string) => void;
    onToggleCase: () => void;
    onStepFind: (delta: number) => void;
    onCloseFind: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onSelectAll: () => void;
    onOpenFind: () => void;
    onClear: () => void;
    onRestart: () => void;
    onCloseTab: () => void;
  }

  let {
    tab,
    findOpen,
    findQuery,
    findCase,
    matchCount,
    matchIndex,
    contextMenu,
    hasSelection,
    onFindQuery,
    onToggleCase,
    onStepFind,
    onCloseFind,
    onCopy,
    onPaste,
    onSelectAll,
    onOpenFind,
    onClear,
    onRestart,
    onCloseTab,
  }: Props = $props();

  let findInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (findOpen) {
      void tick().then(() => {
        findInput?.focus();
        findInput?.select();
      });
    }
  });

  function onFindKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseFind();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onStepFind(event.shiftKey ? -1 : 1);
    }
  }
</script>

{#if findOpen}
  <div class="term-find" role="search" aria-label={t("Find in terminal")}>
    <input
      bind:this={findInput}
      type="text"
      placeholder={t("Find in terminal…")}
      value={findQuery}
      oninput={(event) => onFindQuery(event.currentTarget.value)}
      onkeydown={onFindKeydown}
    />
    <span class="term-find-count">
      {#if findQuery}
        {matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : "0"}
      {/if}
    </span>
    <button
      class="term-find-btn"
      type="button"
      aria-pressed={findCase}
      aria-label={t("Match case")}
      data-tooltip={t("Match case")}
      onclick={onToggleCase}
    >
      Aa
    </button>
    <button
      class="term-find-btn"
      type="button"
      disabled={matchCount === 0}
      aria-label={t("Previous match")}
      data-tooltip={t("Previous match")}
      onclick={() => onStepFind(-1)}
    >
      <Icon name="arrow-up" size={13} />
    </button>
    <button
      class="term-find-btn"
      type="button"
      disabled={matchCount === 0}
      aria-label={t("Next match")}
      data-tooltip={t("Next match")}
      onclick={() => onStepFind(1)}
    >
      <Icon name="arrow-down" size={13} />
    </button>
    <button class="term-find-btn" type="button" aria-label={t("Close search")} onclick={onCloseFind}>
      <Icon name="x" size={13} />
    </button>
  </div>
{/if}

{#if contextMenu}
  <div
    class="term-menu"
    role="menu"
    tabindex="-1"
    style:left={`${contextMenu.x}px`}
    style:top={`${contextMenu.y}px`}
    onpointerdown={(event) => event.stopPropagation()}
  >
    <button class="term-menu-item" type="button" role="menuitem" disabled={!hasSelection} onclick={onCopy}>
      <span>{t("Copy")}</span>
      <kbd>{macPlatform ? `${modLabel}+C` : "Ctrl+Shift+C"}</kbd>
    </button>
    <button class="term-menu-item" type="button" role="menuitem" onclick={onPaste}>
      <span>{t("Paste")}</span>
      <kbd>{macPlatform ? `${modLabel}+V` : "Ctrl+Shift+V"}</kbd>
    </button>
    <button class="term-menu-item" type="button" role="menuitem" onclick={onSelectAll}>
      <span>{t("Select all")}</span>
    </button>
    <div class="term-menu-divider"></div>
    <button class="term-menu-item" type="button" role="menuitem" onclick={onOpenFind}>
      <span>{t("Find in terminal")}</span>
      <kbd>{modLabel}+F</kbd>
    </button>
    <button class="term-menu-item" type="button" role="menuitem" onclick={onClear}>
      <span>{t("Clear terminal")}</span>
      <kbd>{macPlatform ? `${modLabel}+K` : "Ctrl+Shift+K"}</kbd>
    </button>
    {#if tab.owner === "user"}
      <button class="term-menu-item" type="button" role="menuitem" onclick={onRestart}>
        <span>{t("Restart terminal")}</span>
      </button>
    {/if}
    <div class="term-menu-divider"></div>
    <button class="term-menu-item" type="button" role="menuitem" onclick={onCloseTab}>
      <span>{t("Close terminal")}</span>
    </button>
  </div>
{/if}
