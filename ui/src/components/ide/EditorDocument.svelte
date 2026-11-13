<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { IdeWorkspace } from "../../lib/ide.svelte";
  import { isDirty, type IdeDocument } from "../../lib/ide-document";
  import type { EditorAction } from "../../lib/ide/editor-actions";
  import { splitPath } from "../../lib/file-text";
  import { modLabel } from "../../lib/platform";
  import Icon from "../Icon.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import TwinCorrection from "../twin/TwinCorrection.svelte";
  let { ide, document, action, focused, onFocus, onCursor, onClose }: { ide: IdeWorkspace; document: IdeDocument; action: { name: EditorAction; token: number } | null; focused: boolean; onFocus: () => void; onCursor: (line: number, column: number) => void; onClose?: () => void } = $props();
  const parts = $derived(splitPath(document.path));
  const readOnly = $derived(!document.file?.hash || !!document.file.readOnlyReason);
</script>
<div class="document-view" onfocusin={onFocus}>
  <div class="file-toolbar"><span class="breadcrumb" title={document.path}><Icon name="file" size={12} /><span class="dir">{parts.dir}</span><span class="name">{parts.name}</span></span>
    <button type="button" title={t("Reload from disk")} aria-label={t("Reload from disk")} onclick={() => void ide.reload(document.path)}><Icon name="refresh" size={14} /></button>
    <button class="save-file" type="button" disabled={readOnly || !isDirty(document) || document.saving} title={t("Save ({0}+S)", [modLabel])} onclick={() => void ide.save(document.path)}>{document.saving ? t("Saving…") : t("Save")}</button>
    {#if onClose}<button type="button" aria-label={t("Close split")} onclick={onClose}><Icon name="x" size={14} /></button>{/if}
  </div>
  {#if document.changedOnDisk}<div class="file-notice" role="status">{t("The file changed on disk. Your edits are still in the editor.")}<button type="button" onclick={() => void ide.reload(document.path)}>{t("Reload")}</button></div>{/if}
  {#if document.error}<div class="file-notice is-error" role="alert">{document.error}<button type="button" onclick={() => void ide.reload(document.path)}>{t("Reload")}</button></div>{/if}
  {#if document.file?.readOnlyReason}<p class="file-notice">{document.file.readOnlyReason}</p>{/if}
  {#if document.loading}<p class="editor-message" role="status">{t("Opening file…")}</p>{:else if document.file?.binary}<p class="editor-message">{t("Binary file. No text view available.")}</p>{/if}
  <div class="editor-host" hidden={!document.file || document.loading || document.file.binary}>
    <CodeEditor path={document.path} value={document.text} openPaths={ide.tabs.map((tab) => tab.path)} readOnly={readOnly || document.loading} preferences={ide.layout.values} {action} location={focused ? ide.location : null} onChange={(text) => ide.update(document.path, text)} onSave={() => void ide.save(document.path)} onContext={(context) => ide.setContext(context)} {onCursor} />
  </div>
  <TwinCorrection correction={ide.correction} path={document.path} />
</div>
