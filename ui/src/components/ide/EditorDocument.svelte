<script lang="ts">
  import { splitPath } from "../../lib/file-text";
  import { t } from "../../lib/i18n.svelte";
  import type { IdeWorkspace } from "../../lib/ide.svelte";
  import { type IdeDocument, isDirty } from "../../lib/ide-document";
  import { fileIcon } from "../../lib/ide/editor";
  import type { EditorAction } from "../../lib/ide/editor-actions";
  import { modLabel } from "../../lib/platform";
  import Icon from "../Icon.svelte";
  import TwinCorrection from "../twin/TwinCorrection.svelte";
  import CodeEditor, { type CursorDetail } from "./CodeEditor.svelte";

  let {
    ide,
    document,
    action,
    focused,
    onFocus,
    onCursor,
    onClose,
  }: {
    ide: IdeWorkspace;
    document: IdeDocument;
    action: { name: EditorAction; token: number } | null;
    focused: boolean;
    onFocus: () => void;
    onCursor: (line: number, column: number, detail?: CursorDetail) => void;
    onClose?: () => void;
  } = $props();

  let activeSymbol = $state<string | null>(null);
  const parts = $derived(splitPath(document.path));
  const dirSegments = $derived(parts.dir ? parts.dir.split("/").filter(Boolean) : []);
  const icon = $derived(fileIcon(document.path));
  const readOnly = $derived(!document.file?.hash || !!document.file.readOnlyReason);
</script>

<div class="document-view" onfocusin={onFocus}>
  <div class="file-toolbar">
    <span class="breadcrumb" data-tooltip={document.path}>
      {#each dirSegments as segment, index (`${index}:${segment}`)}
        <span class="crumb-dir">{segment}</span>
        <span class="crumb-sep" aria-hidden="true"><Icon name="chevron-right" size={11} /></span>
      {/each}
      <span class="crumb-file" style:--file-tint={icon.color}>
        <span class="crumb-icon"><Icon name="file" size={12} /></span>
        <span class="name">{parts.name}</span>
      </span>
      {#if activeSymbol}
        <span class="crumb-sep" aria-hidden="true"><Icon name="chevron-right" size={11} /></span>
        <span class="crumb-symbol">{activeSymbol}</span>
      {/if}
    </span>
    <button
      type="button"
      data-tooltip={t("Reload from disk")}
      aria-label={t("Reload from disk")}
      onclick={() => void ide.reload(document.path)}
    >
      <Icon name="refresh" size={13} />
    </button>
    <button
      class="save-file"
      class:is-dirty={!readOnly && isDirty(document)}
      type="button"
      disabled={readOnly || !isDirty(document) || document.saving}
      data-tooltip={t("Save ({0}+S)", [modLabel])}
      onclick={() => void ide.save(document.path)}
    >
      {document.saving ? t("Saving…") : t("Save")}
    </button>
    {#if onClose}
      <button type="button" aria-label={t("Close split")} onclick={onClose}>
        <Icon name="x" size={14} />
      </button>
    {/if}
  </div>
  {#if document.changedOnDisk}
    <div class="file-notice" role="status">
      {t("The file changed on disk. Your edits are still in the editor.")}
      <button type="button" onclick={() => void ide.reload(document.path)}>{t("Reload")}</button>
    </div>
  {/if}
  {#if document.error}
    <div class="file-notice is-error" role="alert">
      {document.error}
      <button type="button" onclick={() => void ide.reload(document.path)}>{t("Reload")}</button>
    </div>
  {/if}
  {#if document.file?.readOnlyReason}
    <p class="file-notice">{document.file.readOnlyReason}</p>
  {/if}
  {#if document.loading}
    <p class="editor-message" role="status">{t("Opening file…")}</p>
  {:else if document.file?.binary}
    <p class="editor-message">{t("Binary file. No text view available.")}</p>
  {/if}
  <div class="editor-host" hidden={!document.file || document.loading || document.file.binary}>
    <CodeEditor
      path={document.path}
      value={document.text}
      openPaths={ide.tabs.map((tab) => tab.path)}
      loading={!document.file || document.loading || document.file.binary}
      readOnly={readOnly || document.loading}
      preferences={ide.layout.values}
      {action}
      location={focused ? ide.location : null}
      onChange={(text) => ide.update(document.path, text)}
      onSave={() => void ide.save(document.path)}
      onContext={(context) => ide.setContext(context)}
      onSymbol={(name) => (activeSymbol = name)}
      {onCursor}
    />
  </div>
  <TwinCorrection correction={ide.correction} path={document.path} />
</div>
