<script lang="ts">
  import { tick, untrack } from "svelte";
  import { copyText } from "../../lib/clipboard.svelte";
  import { splitPath } from "../../lib/file-text";
  import { t } from "../../lib/i18n.svelte";
  import type { IdeWorkspace } from "../../lib/ide.svelte";
  import { type FileNode, fileTree } from "../../lib/ide-tree";
  import { fileIcon } from "../../lib/ide/editor";
  import Icon from "../Icon.svelte";
  import "./explorer.css";

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
  const gitBadges = $derived.by(() => {
    const map = new Map<string, { code: string; kind: "added" | "modified" | "deleted" }>();
    for (const entry of ide.git.status?.entries ?? []) {
      const raw = entry.worktree.trim() || entry.index.trim();
      if (!raw) continue;
      if (raw === "?" || raw === "A") map.set(entry.path, { code: raw === "?" ? "U" : "A", kind: "added" });
      else if (raw === "D") map.set(entry.path, { code: "D", kind: "deleted" });
      else map.set(entry.path, { code: raw, kind: "modified" });
    }
    return map;
  });

  function toggle(path: string): void {
    expanded = expanded.includes(path) ? expanded.filter((entry) => entry !== path) : [...expanded, path];
  }
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
      event.preventDefault();
      if (node.directory && expanded.includes(node.path)) toggle(node.path);
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
  <div class="project-head">
    <strong data-tooltip={project}>{project}</strong>
    <div>
      <button type="button" aria-label={t("New file")} data-tooltip={t("New file")} onclick={() => onOperation("create-file", parent)}><Icon name="plus" size={14} /></button>
      <button type="button" aria-label={t("New folder")} data-tooltip={t("New folder")} onclick={() => onOperation("create-folder", parent)}><Icon name="folder-plus" size={14} /></button>
      <button type="button" aria-label={t("Refresh files")} data-tooltip={t("Refresh files")} onclick={() => void ide.requestRefresh()}><Icon name="refresh" size={13} /></button>
      <button type="button" aria-label={t("Collapse folders")} data-tooltip={t("Collapse folders")} onclick={() => (expanded = [])}><Icon name="layers" size={13} /></button>
      <button type="button" aria-label={t("Open project folder")} data-tooltip={t("Open project folder")} onclick={onChooseProject}><Icon name="folder" size={14} /></button>
    </div>
  </div>
  <label class="filter"><Icon name="search" size={13} /><input aria-label={t("Filter files")} placeholder={t("Filter files")} bind:value={query} /></label>
  {#if ide.filesLimited && !ide.filesError}
    <div class="file-limit" role="status"><p>{t("Only part of this folder is shown. Open a project folder to see its files.")}</p><button class="retry" type="button" onclick={onChooseProject}>{t("Open project folder")}</button></div>
  {/if}
  <div class="tree">
    {#if ide.filesError}<p role="alert">{ide.filesError}</p><button class="retry" type="button" onclick={() => void ide.requestRefresh()}>{t("Retry")}</button>
    {:else if ide.loadingFiles && ide.files.length === 0}<p role="status">{t("Loading files…")}</p>
    {:else if nodes.length === 0}{#if !ide.filesLimited}<p>{query ? t("No files found. Change the filter.") : t("This project has no files yet. Create your first file with the + button.")}</p>{/if}
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
    {@const badge = !node.directory ? gitBadges.get(node.path) : undefined}
    {@const tint = !node.directory ? fileIcon(node.path) : null}
    <div class="tree-row" class:active={!node.directory && node.path === ide.activePath} class:git-modified={badge?.kind === "modified"} class:git-added={badge?.kind === "added"} class:git-deleted={badge?.kind === "deleted"}>
      {#if depth > 0}
        <span class="indent-guides" aria-hidden="true">
          {#each Array(depth) as _, level (level)}<span class="guide" style:left={`${17 + level * 14}px`}></span>{/each}
        </span>
      {/if}
      <button class="entry" type="button" style:padding-left={`${12 + depth * 14}px`} data-tooltip={node.path} aria-expanded={node.directory ? query.length > 0 || expanded.includes(node.path) : undefined} aria-current={!node.directory && node.path === ide.activePath ? "page" : undefined} onfocus={() => { selected = node.path; directory = node.directory; }} onclick={() => (node.directory ? toggle(node.path) : onOpen(node.path))} onkeydown={(event) => treeKey(event, node)} oncontextmenu={(event) => context(event, node)}>
        {#if node.directory}<Icon name={!expanded.includes(node.path) && !query ? "chevron-right" : "chevron-down"} size={12} /><Icon name="folder" size={14} />{:else}<span class="file-indent"></span><span class="file-tint" style:color={tint?.color}><Icon name="file" size={14} /></span>{/if}
        <span class="node-name">{node.name}</span>
      </button>
      {#if badge}<span class="git-badge" aria-hidden="true">{badge.code}</span>{/if}
      <button class="row-actions" type="button" aria-label={t("Actions for {0}", [node.path])} data-tooltip={t("Actions for {0}", [node.path])} onclick={(event) => context(event, node)}><Icon name="more" size={14} /></button>
    </div>
    {#if node.directory && (query || expanded.includes(node.path))}{@render entries(node.children, depth + 1)}{/if}
  {/each}
{/snippet}
