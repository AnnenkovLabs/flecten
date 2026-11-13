<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { FileChange } from "../lib/types";
  import FileTypeBadge from "./FileTypeBadge.svelte";

  interface Props {
    file: FileChange;
    onOpen: () => void;
  }

  let { file, onOpen }: Props = $props();
</script>

<button
  class="file-change"
  type="button"
  title={t("Open changes for {0}", [file.path])}
  onclick={onOpen}
>
  <FileTypeBadge kind={file.kind} />
  <span>{file.path}</span>
  <span class="add">+{file.add}</span>
  {#if file.del}
    <span class="del">−{file.del}</span>
  {/if}
</button>

<style>
  .file-change {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px 0 8px;
    border-radius: 8px;
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.07),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    color: var(--text-2);
    font-size: 13px;
    transition:
      background var(--t-touch) var(--ease),
      box-shadow var(--t-touch) var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .file-change:hover {
    border-radius: 12px;
    background: rgba(240, 239, 237, 0.04);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
</style>
