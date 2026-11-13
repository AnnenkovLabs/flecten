<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { countLabel } from "../lib/format";
  import type { DiffFile as DiffFileType } from "../lib/types";
  import DiffFile from "./DiffFile.svelte";
  import Icon from "./Icon.svelte";

  let { files }: { files: DiffFileType[] } = $props();

  const adds = $derived(files.reduce((total, file) => total + file.add, 0));
  const dels = $derived(files.reduce((total, file) => total + (file.del ?? 0), 0));
  const fileLabel = $derived(`${countLabel(files.length, "file")}`);
</script>

{#if files.length === 0}
  <div class="empty">
    <Icon name="branch" size={24} />
    <h2>{t("No changes yet")}</h2>
    <p>{t("Files and edits made by the agent in this task will appear here.")}</p>
    <span>{t("Continue working in the Conversation tab.")}</span>
  </div>
{:else}
  <div class="pane-meta">
    <span>{fileLabel}</span>
    <span class="add">+{adds}</span>
    {#if dels}
      <span class="del">−{dels}</span>
    {/if}
  </div>
{/if}

{#each files as file (file.path)}
  <div class="diff-slot">
    <DiffFile {file} />
  </div>
{/each}

<style>
  .pane-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 16px;
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }

  .diff-slot + .diff-slot {
    margin-top: 8px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 48px 24px;
    color: var(--muted);
    text-align: center;
  }

  .empty h2 { color: var(--text); font-size: 18px; font-weight: 500; }
  .empty p { max-width: 38ch; color: var(--text-2); font-size: 14px; }
  .empty span { font-size: 12px; }

</style>
