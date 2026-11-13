<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { IdeGit } from "../../lib/ide/git.svelte";
  import { splitPath } from "../../lib/file-text";
  import Icon from "../Icon.svelte";
  let { git, onDiff }: { git: IdeGit; onDiff: (path: string, staged: boolean) => void } = $props();
  const staged = $derived(git.status?.entries.filter((entry) => entry.index !== " " && entry.index !== "?") ?? []);
  const changes = $derived(git.status?.entries.filter((entry) => entry.worktree !== " ") ?? []);
</script>
<aside class="source-control" aria-label="{t("Source control")}">
  <header><strong>{t("Source control")}</strong><button type="button" aria-label="{t("Refresh Git")}" title="{t("Refresh Git")}" disabled={git.busy} onclick={() => void git.refresh()}><Icon name="refresh" size={14} /></button></header>
  {#if git.status?.repository}<div class="branch"><Icon name="branch" size={14} />{git.status.branch}</div><form onsubmit={(event) => { event.preventDefault(); void git.commit(); }}><label for="commit-message">{t("Commit message")}</label><textarea id="commit-message" rows="2" bind:value={git.message} placeholder="{t("Briefly describe the changes")}" required></textarea><button type="submit" disabled={git.busy || !staged.length || !git.message.trim()}><Icon name="check" size={14} />{t("Create commit")} <small>{staged.length}</small></button></form>{/if}
  {#if git.error}<p class="error" role="alert">{git.error}</p>{/if}
  <div class="git-files">
  {#if !git.status}<p role="status">{t("Checking Git…")}</p>{:else if !git.status.repository}<p>{t("This folder has no Git repository. Create one by running git init in the terminal.")}</p>{:else}
    {#each [{ label: t("Staged"), files: staged, staged: true }, { label: t("Changes"), files: changes, staged: false }] as group}<details open><summary>{group.label}<span>{group.files.length}</span></summary>{#each group.files as entry (entry.path)}<div class="git-file"><button class="open-diff" type="button" title={entry.path} onclick={() => onDiff(entry.path, group.staged)}><Icon name="file" size={14} /><span>{splitPath(entry.path).name}<small>{splitPath(entry.path).dir}</small></span><b>{group.staged ? entry.index : entry.worktree}</b></button><button type="button" disabled={git.busy} aria-label={`${group.staged ? t("Unstage") : t("Stage")} ${entry.path}`} title={group.staged ? t("Unstage") : t("Stage")} onclick={() => void git.change(group.staged ? "unstage" : "stage", entry.path)}><Icon name={group.staged ? "x" : "plus"} size={14} /></button></div>{/each}</details>{/each}
    {#if !git.status.entries.length}<p>{t("No changes. The working tree is clean.")}</p>{/if}
  {/if}
  </div>
</aside>
<style>
  aside { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--sidebar); font-size: 13px; } header { display: flex; align-items: center; justify-content: space-between; height: 40px; padding-inline: 16px 8px; flex: none; } strong { font-weight: 600; font-size: 13px; } button { min-height: 28px; min-width: 28px; color: var(--text-2); } .branch { display: flex; align-items: center; gap: 6px; padding-inline: 12px; color: var(--muted); font-size: 12px; } form { display: flex; flex-direction: column; gap: 6px; padding: 12px; } label { font-size: 12px; color: var(--text-2); } textarea { resize: vertical; min-width: 0; min-height: 56px; max-height: 160px; padding: 6px 8px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--bg); font: inherit; } form button { display: flex; justify-content: center; align-items: center; gap: 8px; padding-inline: 8px; background: var(--raised); border-radius: 4px; } button:disabled { opacity: .45; } .git-files { flex: 1; min-height: 0; overflow: auto; } summary { display: flex; justify-content: space-between; cursor: pointer; padding: 6px 12px; min-height: 28px; font-size: 12px; color: var(--text-2); } summary span { color: var(--muted); } .git-file { display: flex; min-width: 0; padding-inline-end: 6px; } .open-diff { display: flex; align-items: center; gap: 6px; padding-inline: 12px 6px; min-width: 0; flex: 1; text-align: start; font-size: 12px; } .open-diff > span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { color: var(--muted); font-size: 11px; margin-inline-start: 6px; } b { font-weight: 500; font-size: 11px; } .git-file:hover { background: var(--surface); } p { padding: 8px 12px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; } p.error { color: var(--error); }
</style>
