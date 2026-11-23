<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { type IdeDocument, isDirty } from "../../lib/ide-document";
  import type { CommandId } from "../../lib/ide/commands";
  import { detectEol, editorLanguage } from "../../lib/ide/editor";
  import Icon from "../Icon.svelte";

  let {
    branch,
    project,
    target,
    reviewing,
    line,
    column,
    selectedChars,
    cursors,
    tabSize,
    wrap,
    minimap,
    onOpenGit,
    onToggleTabSize,
    onExecute,
  }: {
    branch: string;
    project: string;
    target: IdeDocument | null;
    reviewing: boolean;
    line: number;
    column: number;
    selectedChars: number;
    cursors: number;
    tabSize: 2 | 4;
    wrap: boolean;
    minimap: boolean;
    onOpenGit: () => void;
    onToggleTabSize: () => void;
    onExecute: (id: CommandId) => void;
  } = $props();
</script>

<footer class="ide-status">
  <button class="status-branch" data-tooltip={branch || project} onclick={onOpenGit}>
    <Icon name="branch" size={12} />{branch || project}
  </button>
  <span class="status-spacer"></span>
  {#if target && !reviewing}
    <span class="save-status">
      {!target.file?.hash
        ? t("Read-only")
        : target.saving
          ? t("Saving…")
          : isDirty(target)
            ? t("Unsaved")
            : t("Saved")}
    </span>
    <button data-tooltip={t("Go to line")} onclick={() => onExecute("go-line")}>
      {t("Ln {0}, Col {1}", [line, column])}
      {#if cursors > 1}
        <span class="status-meta">({t("{0} cursors", [cursors])})</span>
      {:else if selectedChars > 0}
        <span class="status-meta">({t("{0} selected", [selectedChars])})</span>
      {/if}
    </button>
    <button data-tooltip={t("Change indent size")} onclick={onToggleTabSize}>
      {t("Spaces: {0}", [tabSize])}
    </button>
    <span class="encoding">UTF-8 · {detectEol(target.text)}</span>
    <button
      class="status-minimap"
      data-tooltip={t("Toggle minimap")}
      aria-pressed={minimap}
      onclick={() => onExecute("minimap")}
    >
      {t("Minimap")}
    </button>
    <button
      data-tooltip={t("Wrap long lines")}
      aria-pressed={wrap}
      onclick={() => onExecute("wrap")}
    >
      {editorLanguage(target.path).label}
    </button>
  {/if}
</footer>
