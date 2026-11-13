<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { untrack } from "svelte";
  import { modal } from "../../lib/modal";
  import type { IdeWorkspace } from "../../lib/ide.svelte";
  let { ide, operation, path, onClose }: { ide: IdeWorkspace; operation: "create-file" | "create-folder" | "rename" | "trash"; path: string; onClose: () => void } = $props();
  let input = $state<HTMLInputElement>();
  let cancel: HTMLButtonElement;
  let value = $state(untrack(() => operation === "rename" ? path : path ? `${path}/` : ""));
  let busy = $state(false);
  let error = $state("");
  const title = $derived(({ "create-file": t("New file"), "create-folder": t("New folder"), rename: t("Rename"), trash: t("Delete from project") })[operation]);
  async function submit(): Promise<void> {
    busy = true; error = "";
    try { await ide.change(operation, operation === "rename" || operation === "trash" ? path : value, operation === "rename" ? value : ""); onClose(); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }
</script>
<dialog class="file-operation" use:modal={() => operation === "trash" ? cancel : input} aria-label={title} oncancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
  <form onsubmit={(event) => { event.preventDefault(); void submit(); }}>
    <h2>{title}</h2>
    {#if operation === "trash"}<p>{t("Delete “{0}”? The file or folder will be moved to the project's local trash.", [path])}</p>{:else}<label for="operation-path">{t("Path from project root")}</label><input id="operation-path" bind:this={input} bind:value={value} required spellcheck="false" aria-invalid={!!error} aria-describedby={error ? "operation-error" : "operation-hint"} /><p id="operation-hint">{operation === "rename" ? t("You can move it to another existing folder.") : t("For example: src/example.ts. The parent folder must exist.")}</p>{/if}
    {#if error}<p id="operation-error" class="error" role="alert">{error}</p>{/if}
    <footer><button type="button" bind:this={cancel} disabled={busy} onclick={onClose}>{t("Cancel")}</button><button class:danger={operation === "trash"} type="submit" disabled={busy}>{busy ? t("Applying…") : title}</button></footer>
  </form>
</dialog>
<style>
  dialog { width: min(460px, calc(100vw - 32px)); padding: 24px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--raised); color: var(--text); } dialog::backdrop { background: #0007; } form { display: flex; flex-direction: column; gap: 12px; } h2 { margin: 0; font-size: 18px; font-weight: 600; } label { font-size: 13px; color: var(--text-2); } input { width: 100%; min-height: 36px; padding: 6px 10px; background: var(--bg); border: 1px solid var(--line-strong); border-radius: 4px; font-size: 13px; } p { margin: 0; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; } .error { color: var(--error); } footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; } button { padding: 6px 12px; border-radius: 5px; min-height: 32px; background: var(--surface); } button[type="submit"] { background: var(--primary); color: var(--on-primary); } button.danger { background: var(--error); color: var(--on-primary); }
</style>
