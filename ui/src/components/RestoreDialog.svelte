<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { countLabel } from "../lib/format";
  import type { RestorePrompt } from "../lib/run/checkpoints.svelte";
  import Dialog from "./Dialog.svelte";

  interface Props {
    prompt: RestorePrompt;
    onResolve: (choice: { overwrite: boolean; includeProtected: boolean }) => void;
    onDismiss: () => void;
  }

  let { prompt, onResolve, onDismiss }: Props = $props();

  const SHOWN = 6;
  let overwrite = $state(true);
  let includeProtected = $state(false);
  const chosen = $derived(
    (overwrite ? prompt.conflicts.length : 0) + (includeProtected ? prompt.protectedPaths.length : 0),
  );
  const verb = $derived(prompt.target === "before" ? t("Roll back") : t("Restore"));

  function files(count: number): string {
    return `${countLabel(count, "file")}`;
  }
</script>

{#snippet paths(list: string[])}
  <ul class="paths">
    {#each list.slice(0, SHOWN) as path (path)}
      <li><code title={path}>{path}</code></li>
    {/each}
    {#if list.length > SHOWN}
      <li class="more">{t("and {0} more", [files(list.length - SHOWN)])}</li>
    {/if}
  </ul>
{/snippet}

<Dialog
  title={t("Some files were left unchanged")}
  description={t("Restoring does not overwrite other changes or settings without asking. Select what to restore anyway.")}
  {onDismiss}
>
  <code class="label" title={prompt.label}>{prompt.label}</code>

  {#if prompt.conflicts.length > 0}
    <div>
      <label class="choice">
        <input type="checkbox" bind:checked={overwrite} />
        <span class="choice-copy">
          <strong>{t("Overwrite files changed later: {0}", [files(prompt.conflicts.length)])}</strong>
          <span>{t("You or another run changed these files after the snapshot.")}</span>
        </span>
      </label>
      {@render paths(prompt.conflicts)}
    </div>
  {/if}

  {#if prompt.protectedPaths.length > 0}
    <div>
      <label class="choice">
        <input type="checkbox" bind:checked={includeProtected} />
        <span class="choice-copy">
          <strong>{t("Restore settings and secrets: {0}", [files(prompt.protectedPaths.length)])}</strong>
          <span>{t("Agent configuration, permissions, and .env are not rolled back by default.")}</span>
        </span>
      </label>
      {@render paths(prompt.protectedPaths)}
    </div>
  {/if}

  {#snippet actions()}
    <button class="st-btn st-btn--quiet" type="button" onclick={onDismiss}>{t("Leave as is")}</button>
    <button
      class="st-btn st-btn--primary"
      type="button"
      disabled={chosen === 0}
      onclick={() => onResolve({ overwrite, includeProtected })}
    >
      {verb}: {files(chosen)}
    </button>
  {/snippet}
</Dialog>

<style>
  .label {
    overflow: hidden;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .choice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
  }

  .choice input {
    width: 16px;
    height: 16px;
    margin: 2px 0 0;
    flex: none;
    accent-color: var(--primary);
  }

  .choice-copy {
    display: grid;
    gap: 3px;
    font-size: 13px;
  }

  .choice-copy span {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .paths {
    display: grid;
    gap: 2px;
    margin: 8px 0 0 26px;
    padding: 0;
    list-style: none;
  }

  .paths code {
    display: block;
    overflow: hidden;
    color: var(--text-body);
    font-family: var(--mono);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .more {
    color: var(--muted);
    font-size: 12px;
  }
</style>
