<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { DiffFile } from "../../lib/types";
  import { splitPath } from "../../lib/file-text";
  import Icon from "../Icon.svelte";
  let { files, selected, onSelect, onClose }: { files: DiffFile[]; selected: string | null; onSelect: (path: string) => void; onClose: () => void } = $props();
  const adds = $derived(files.reduce((sum, file) => sum + file.add, 0));
  const dels = $derived(files.reduce((sum, file) => sum + (file.del ?? 0), 0));
</script>
<aside class="agent-changes" aria-label={t("Agent changes")}>
  <header><h2>{t("Changes")} <span>{files.length}</span></h2><button type="button" title={t("Hide changes")} aria-label={t("Hide changes")} onclick={onClose}><Icon name="x" size={15} /></button></header>
  {#if files.length}
    <p class="totals"><span class="add">+{adds}</span><span class="del">−{dels}</span><span>{t("in this task")}</span></p>
    <div class="files">
      {#each files as file (file.path)}
        {@const parts = splitPath(file.path)}
        <button class="change" class:active={selected === file.path} title={file.path} type="button" aria-pressed={selected === file.path} onclick={() => onSelect(file.path)}>
          <Icon name="file" size={15} /><span class="path"><strong>{parts.name}</strong>{#if parts.dir}<small>{parts.dir.slice(0, -1)}</small>{/if}</span>
          <span class="stat"><span class="add">+{file.add}</span>{#if file.del}<span class="del">−{file.del}</span>{/if}</span><span class="state">{file.state}</span>
        </button>
      {/each}
    </div>
    <p class="hint">{t("Select a file to view changes.")}</p>
  {:else}
    <div class="empty"><Icon name="branch" size={22} /><h3>{t("No changes yet")}</h3><p>{t("Files the agent changes in this task will appear here.")}</p></div>
  {/if}
</aside>
<style>
  .agent-changes { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--panel); border-left: 1px solid var(--line); }
  header { display: flex; align-items: center; gap: 8px; justify-content: space-between; padding: 0 8px 0 16px; min-height: 44px; }
  h2 { font-size: 13px; font-weight: 600; } h2 span { margin-left: 6px; color: var(--muted); font-size: 12px; }
  header button { display: grid; place-items: center; width: 40px; height: 40px; color: var(--muted); }
  button:hover { background: var(--surface); color: var(--text); }
  .totals { display: flex; gap: 9px; padding: 4px 16px 14px; color: var(--muted); font-size: 12px; }
  .files { overflow: auto; min-height: 0; }
  .change { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 54px; padding: 8px 14px; text-align: left; color: var(--text-2); }
  .change.active { background: var(--raised); color: var(--text); }
  .path { display: flex; flex: 1; flex-direction: column; min-width: 0; } strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; } small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
  .stat { display: flex; gap: 5px; font-family: var(--mono); font-size: 12px; } .state { color: var(--muted); font-family: var(--mono); font-size: 12px; }
  .hint { padding: 16px; font-size: 12px; color: var(--muted); }
  .empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 36px 20px; color: var(--muted); text-align: center; } h3 { color: var(--text-2); font-size: 13px; font-weight: 500; } .empty p { font-size: 13px; }
</style>
