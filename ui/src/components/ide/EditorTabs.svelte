<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { tick } from "svelte";
  import type { IdeWorkspace } from "../../lib/ide.svelte";
  import { isDirty } from "../../lib/ide-document";
  import { splitPath } from "../../lib/file-text";
  import Icon from "../Icon.svelte";
  let { ide, reviewing, onSelect }: { ide: IdeWorkspace; reviewing: boolean; onSelect: (path: string) => void } = $props();
  let menu: HTMLDivElement;
  let contextPath = $state("");
  let left = $state(0);
  let top = $state(0);
  function context(event: MouseEvent, path: string): void {
    event.preventDefault(); contextPath = path;
    left = Math.min(event.clientX, window.innerWidth - 240); top = Math.min(event.clientY, window.innerHeight - 180);
    menu.showPopover(); queueMicrotask(() => menu.querySelector("button")?.focus());
  }
  function keydown(event: KeyboardEvent, path: string): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = ide.tabs.findIndex((tab) => tab.path === path);
    const next = event.key === "Home" ? 0 : event.key === "End" ? ide.tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : ide.tabs.length - 1)) % ide.tabs.length;
    const tab = ide.tabs[next]; if (tab) { onSelect(tab.path); void tick().then(() => document.querySelector<HTMLButtonElement>(`.editor-tabs [data-path="${CSS.escape(tab.path)}"]`)?.focus()); }
  }
  let dragging = "";
  function drop(path: string): void {
    if (!dragging || dragging === path) return;
    const tabs = ide.tabs.filter((tab) => tab.path !== dragging);
    const moved = ide.tabs.find((tab) => tab.path === dragging);
    if (moved) { tabs.splice(tabs.findIndex((tab) => tab.path === path), 0, moved); ide.tabs = tabs; }
    dragging = "";
  }
</script>
<div class="editor-tabs" role="tablist" aria-label={t("Open files")}>
  {#each ide.tabs as tab (tab.path)}
    <div class="editor-tab" class:active={!reviewing && ide.activePath === tab.path} role="presentation" oncontextmenu={(event) => context(event, tab.path)} onauxclick={(event) => { if (event.button === 1) { event.preventDefault(); ide.close(tab.path); } }}>
      <button class="tab-name" type="button" role="tab" draggable="true" ondragstart={() => dragging = tab.path} ondragover={(event) => event.preventDefault()} ondrop={(event) => { event.preventDefault(); drop(tab.path); }} aria-selected={!reviewing && ide.activePath === tab.path} aria-controls="ide-editor" tabindex={ide.activePath === tab.path ? 0 : -1} data-path={tab.path} title={tab.path} onclick={() => onSelect(tab.path)} onkeydown={(event) => keydown(event, tab.path)}><Icon name="file" size={14} /><span>{splitPath(tab.path).name}</span>{#if ide.tabs.some((other) => other.path !== tab.path && splitPath(other.path).name === splitPath(tab.path).name)}<small>{splitPath(tab.path).dir}</small>{/if}{#if isDirty(tab)}<span class="dirty" aria-label={t("Unsaved")}>●</span>{/if}</button>
      <button class="tab-close" type="button" title={t("Close {0}", [tab.path])} aria-label={t("Close {0}", [tab.path])} onclick={() => ide.close(tab.path)}><Icon name="x" size={12} /></button>
    </div>
  {/each}
</div>
<div popover="auto" class="tab-menu" bind:this={menu} style:top={`${top}px`} style:left={`${left}px`}>
  <button type="button" onclick={() => { menu.hidePopover(); ide.close(contextPath); }}>{t("Close")}</button>
  <button type="button" onclick={() => { menu.hidePopover(); ide.closeMany(ide.tabs.filter((tab) => tab.path !== contextPath).map((tab) => tab.path)); }}>{t("Close others")}</button>
  <button type="button" onclick={() => { menu.hidePopover(); const index = ide.tabs.findIndex((tab) => tab.path === contextPath); ide.closeMany(ide.tabs.slice(index + 1).map((tab) => tab.path)); }}>{t("Close to the right")}</button>
  <button type="button" onclick={() => { menu.hidePopover(); ide.closeMany(ide.tabs.map((tab) => tab.path)); }}>{t("Close all")}</button>
</div>
<style>
  small { max-width: 140px; overflow: hidden; text-overflow: ellipsis; color: var(--muted); font-size: 11px; } .tab-menu { position: fixed; margin: 0; width: 230px; padding: 4px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--raised); box-shadow: 0 8px 24px #0005; color: var(--text-2); } .tab-menu button { display: block; width: 100%; min-height: 30px; padding-inline: 10px; text-align: start; border-radius: 4px; font-size: 12px; } .tab-menu button:hover { background: var(--raised-hover); }
</style>
