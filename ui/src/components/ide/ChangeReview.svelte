<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { DiffFile } from "../../lib/types";
  import { splitPath } from "../../lib/file-text";
  import Icon from "../Icon.svelte";
  let { file, onEdit, onClose }: { file: DiffFile; onEdit: () => void; onClose: () => void } = $props();
  const parts = $derived(splitPath(file.path));
</script>
<section class="review" aria-label={t("Changes to {0}", [file.path])}>
  <header><span class="path" title={file.path}><span class="dir">{parts.dir}</span><span class="name">{parts.name}</span></span><span class="add">+{file.add}</span><span class="del">−{file.del ?? 0}</span><button type="button" onclick={onEdit}><Icon name="edit" size={14} />{t("Edit file")}</button><button class="close" type="button" title={t("Close diff")} aria-label={t("Close diff")} onclick={onClose}><Icon name="x" size={15} /></button></header>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex: keyboard users scroll the code region. -->
  <div class="diff" tabindex="0" role="region" aria-label={t("File diff")}>
    {#if file.hunks.length === 0}<p>{t("Text diff unavailable. Open the current version of the file in the editor.")}</p>{/if}
    {#each file.hunks as hunk}
      <div class="hunk">{hunk.header}</div>
      {#each hunk.lines as line}
        <div class="line" class:added={line.kind === "add"} class:deleted={line.kind === "del"}><span class="number">{line.oldLine ?? ""}</span><span class="number">{line.newLine ?? ""}</span><span class="sign">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span><pre>{line.text || " "}</pre></div>
      {/each}
    {/each}
  </div>
</section>
<style>
  .review { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  header { display: flex; align-items: center; flex: none; gap: 12px; min-height: 42px; padding: 0 8px 0 18px; border-bottom: 1px solid var(--line); font-size: 12px; }
  .path { display: flex; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; color: var(--text-2); font-family: var(--mono); }
  .dir { overflow: hidden; text-overflow: ellipsis; }
  .name { flex: none; max-width: 75%; overflow: hidden; text-overflow: ellipsis; }
  button { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 0 8px; border-radius: 5px; color: var(--text-2); white-space: nowrap; } button:hover { background: var(--raised); color: var(--text); }
  .diff { flex: 1; overflow: auto; min-height: 0; font-family: var(--mono); font-size: 13px; line-height: 22px; padding-bottom: 24px; }
  .hunk { padding: 8px 20px; color: var(--muted); background: var(--surface); white-space: pre; }
  .line { display: flex; width: max-content; min-width: 100%; color: var(--text-body); }
  .number { width: 48px; flex: none; padding-right: 12px; color: var(--muted); text-align: right; user-select: none; }
  .sign { width: 22px; flex: none; text-align: center; user-select: none; } pre { margin: 0; padding-right: 24px; font: inherit; tab-size: 2; }
  .added { background: color-mix(in srgb, var(--add) 9%, transparent); } .added .sign { color: var(--add); } .deleted { background: color-mix(in srgb, var(--del) 9%, transparent); } .deleted .sign { color: var(--del); }
  p { font-family: var(--font); color: var(--muted); padding: 24px; }
  @media(max-width: 600px) { header { gap: 6px; padding-left: 8px; } .number { width: 32px; padding-right: 6px; } }
</style>
