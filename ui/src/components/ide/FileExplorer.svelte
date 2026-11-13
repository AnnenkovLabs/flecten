<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { copyText } from "../../lib/clipboard.svelte";
  import { tick, untrack } from "svelte";
  import type { IdeWorkspace } from "../../lib/ide.svelte";
  import { fileTree, type FileNode } from "../../lib/ide-tree";
  import { isDirty } from "../../lib/ide-document";
  import { splitPath } from "../../lib/file-text";
  import Icon from "../Icon.svelte";
  let { ide, project, onOpen, onOperation, onChooseProject }: {
    ide: IdeWorkspace; project: string; onOpen: (path: string) => void;
    onOperation: (operation: "create-file" | "create-folder" | "rename" | "trash", path: string) => void;
    onChooseProject: () => void;
  } = $props();
  let query = $state("");
  let expanded = $state<string[]>([]);
  let selected = $state("");
  let directory = $state(false);
  let menu: HTMLDivElement;
  let menuLeft = $state(0);
  let menuTop = $state(0);
  const nodes = $derived(fileTree(ide.files, query, ide.directories));
  const parent = $derived(directory ? selected : splitPath(selected).dir.slice(0, -1));
  function toggle(path: string): void { expanded = expanded.includes(path) ? expanded.filter((entry) => entry !== path) : [...expanded, path]; }
  function context(event: MouseEvent | KeyboardEvent, node: FileNode): void {
    event.preventDefault(); selected = node.path; directory = node.directory;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menuLeft = Math.min(event instanceof MouseEvent && event.type === "contextmenu" ? event.clientX : rect.right, window.innerWidth - 220);
    menuTop = Math.min(rect.bottom, window.innerHeight - 240);
    menu.showPopover(); void tick().then(() => menu.querySelector("button")?.focus());
  }
  function act(operation: "create-file" | "create-folder" | "rename" | "trash"): void {
    menu.hidePopover(); onOperation(operation, operation === "create-file" || operation === "create-folder" ? parent : selected);
  }
  function treeKey(event: KeyboardEvent, node: FileNode): void {
    if (event.key === "F2") { event.preventDefault(); onOperation("rename", node.path); return; }
    if (event.key === "Delete") { event.preventDefault(); onOperation("trash", node.path); return; }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { context(event, node); return; }
    const current = event.currentTarget as HTMLElement;
    const entries = [...current.closest(".tree")!.querySelectorAll<HTMLButtonElement>(".entry")];
    const index = entries.indexOf(current as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      entries[next]?.focus();
    } else if (event.key === "ArrowRight" && node.directory) {
      event.preventDefault(); if (!expanded.includes(node.path)) toggle(node.path); else entries[index + 1]?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault(); if (node.directory && expanded.includes(node.path)) toggle(node.path);
      else entries.find((entry) => entry.title === splitPath(node.path).dir.slice(0, -1))?.focus();
    }
  }
  $effect(() => {
    const path = ide.activePath;
    if (path) untrack(() => {
      const parts = path.split("/"); parts.pop();
      const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
      expanded = [...new Set([...expanded, ...ancestors])];
    });
  });
</script>
<aside class="explorer" aria-label={t("Project files")}>
  <header><span>{t("Explorer")}</span><button type="button" aria-label={t("Open project folder")} title={t("Open project folder")} onclick={onChooseProject}><Icon name="folder" size={15} /></button></header>
  {#if ide.tabs.length}<details class="open-editors" open><summary>{t("Open editors")} <span>{ide.tabs.length}</span></summary>
    {#each ide.tabs as tab (tab.path)}<div class="open-editor" class:active={ide.activePath === tab.path}><button type="button" title={tab.path} onclick={() => onOpen(tab.path)}><Icon name="file" size={13} /><span>{splitPath(tab.path).name}</span>{#if isDirty(tab)}<small aria-label={t("Unsaved")}>●</small>{/if}</button><button type="button" aria-label={t("Close editor {0}", [tab.path])} onclick={() => ide.close(tab.path)}><Icon name="x" size={12} /></button></div>{/each}
  </details>{/if}
  <div class="project-head"><strong title={project}>{project}</strong><div><button type="button" aria-label={t("New file")} title={t("New file")} onclick={() => onOperation("create-file", parent)}><Icon name="plus" size={15} /></button><button type="button" aria-label={t("New folder")} title={t("New folder")} onclick={() => onOperation("create-folder", parent)}><Icon name="folder-plus" size={15} /></button><button type="button" aria-label={t("Refresh files")} title={t("Refresh files")} onclick={() => void ide.requestRefresh()}><Icon name="refresh" size={14} /></button><button type="button" aria-label={t("Collapse folders")} title={t("Collapse folders")} onclick={() => expanded = []}><Icon name="layers" size={14} /></button></div></div>
  <label class="filter"><Icon name="search" size={13} /><input aria-label={t("Filter files")} placeholder={t("Filter files")} bind:value={query} /></label>
  <div class="tree">
    {#if ide.filesError}<p role="alert">{ide.filesError}</p><button class="retry" type="button" onclick={() => void ide.requestRefresh()}>{t("Retry")}</button>
    {:else if ide.loadingFiles && ide.files.length === 0}<p role="status">{t("Loading files…")}</p>
    {:else if nodes.length === 0}<p>{query ? t("No files found. Change the filter.") : t("This project has no files yet. Create your first file with the + button.")}</p>
    {:else}{@render entries(nodes, 0)}{/if}
  </div>
</aside>
<div popover="auto" class="file-menu" bind:this={menu} style:top={`${menuTop}px`} style:left={`${menuLeft}px`}>
  <button type="button" onclick={() => act("create-file")}><Icon name="plus" size={14} />{t("New file")}</button>
  <button type="button" onclick={() => act("create-folder")}><Icon name="folder-plus" size={14} />{t("New folder")}</button>
  <button type="button" onclick={() => { menu.hidePopover(); void copyText(selected); }}><Icon name="copy" size={14} />{t("Copy path")}</button>
  <button type="button" onclick={() => act("rename")}><Icon name="edit" size={14} />{t("Rename / move")}<kbd>F2</kbd></button>
  <button class="danger" type="button" onclick={() => act("trash")}><Icon name="trash" size={14} />{t("Delete")}<kbd>Del</kbd></button>
</div>
{#snippet entries(nodes: FileNode[], depth: number)}
  {#each nodes as node (node.path)}
    <div class="tree-row" class:active={!node.directory && node.path === ide.activePath}>
      <button class="entry" type="button" style:padding-left={`${12 + depth * 14}px`} title={node.path}
        aria-expanded={node.directory ? query.length > 0 || expanded.includes(node.path) : undefined}
        aria-current={!node.directory && node.path === ide.activePath ? "page" : undefined}
        onfocus={() => { selected = node.path; directory = node.directory; }}
        onclick={() => node.directory ? toggle(node.path) : onOpen(node.path)} onkeydown={(event) => treeKey(event, node)} oncontextmenu={(event) => context(event, node)}>
        {#if node.directory}<Icon name={!expanded.includes(node.path) && !query ? "chevron-right" : "chevron-down"} size={12} /><Icon name="folder" size={14} />{:else}<span class="file-indent"></span><Icon name="file" size={14} />{/if}<span>{node.name}</span>
      </button>
      <button class="row-actions" type="button" aria-label={t("Actions for {0}", [node.path])} title={t("Actions for {0}", [node.path])} onclick={(event) => context(event, node)}><Icon name="more" size={14} /></button>
    </div>
    {#if node.directory && (query || expanded.includes(node.path))}{@render entries(node.children, depth + 1)}{/if}
  {/each}
{/snippet}
<style>
  .explorer { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--sidebar); font-size: 13px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 40px; flex: none; padding-inline: 16px 8px; font-size: 13px; font-weight: 600; }
  button { color: var(--muted); } header button, .project-head button { display: grid; place-items: center; width: 28px; height: 28px; }
  .project-head { display: flex; align-items: center; min-height: 36px; padding-inline: 12px 4px; gap: 4px; } .project-head strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; } .project-head > div { display: flex; flex: none; }
  .filter { display: flex; align-items: center; gap: 6px; margin: 0 12px 8px; padding-inline: 6px; border: 1px solid var(--line-strong); border-radius: 4px; color: var(--muted); }
  .filter input { width: 100%; min-width: 0; height: 28px; border: 0; background: none; font-size: 12px; }
  .tree { overflow: auto; flex: 1; min-height: 0; padding-bottom: 12px; } .tree-row { display: flex; min-height: 28px; position: relative; } .entry { display: flex; gap: 6px; align-items: center; min-width: 0; flex: 1; min-height: 28px; padding-inline-end: 8px; color: var(--text-2); text-align: start; font-size: 13px; } .entry span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .file-indent { width: 12px; flex: none; }
  .row-actions { width: 26px; height: 28px; flex: none; opacity: 0; } .tree-row:hover .row-actions, .tree-row:focus-within .row-actions { opacity: 1; } .tree-row:hover, header button:hover, .project-head button:hover { background: var(--surface); color: var(--text); } .tree-row.active { background: var(--raised); box-shadow: inset 2px 0 var(--primary); } .tree-row.active .entry { color: var(--text); }
  .open-editors { max-height: 170px; overflow: auto; flex: none; margin-bottom: 4px; } summary { padding: 4px 12px; min-height: 28px; font-size: 12px; color: var(--text-2); cursor: pointer; } summary span { margin-inline-start: 6px; color: var(--muted); } .open-editor { display: flex; min-width: 0; } .open-editor.active { background: var(--surface); } .open-editor button:first-child { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; padding-inline: 24px 4px; min-height: 28px; font-size: 12px; } .open-editor span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } .open-editor button:last-child { width: 28px; height: 28px; flex: none; }
  p { padding: 12px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; } .retry { margin-inline: 12px; text-decoration: underline; }
  .file-menu { position: fixed; margin: 0; padding: 4px; min-width: 210px; max-width: calc(100vw - 16px); background: var(--raised); color: var(--text-2); border: 1px solid var(--line-strong); border-radius: 6px; box-shadow: 0 8px 24px #0005; } .file-menu button { display: flex; gap: 8px; align-items: center; width: 100%; min-height: 30px; padding: 4px 8px; border-radius: 3px; font-size: 12px; color: var(--text-2); } .file-menu button:hover { background: var(--raised-hover); } .file-menu kbd { margin-inline-start: auto; font-size: 11px; color: var(--muted); } .file-menu .danger { color: var(--error); }
  @media (pointer: coarse) { .entry, .row-actions, .open-editor button:first-child, .open-editor button:last-child, .project-head button, header button { min-height: 44px; } .row-actions { opacity: 1; } }
</style>
