<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import Icon from "../Icon.svelte";

  let {
    diff,
    onClose,
    onEdit,
  }: { diff: { path: string; text: string; staged: boolean }; onClose: () => void; onEdit: () => void } =
    $props();

  type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context";

  function classify(line: string): DiffLineKind {
    if (line.startsWith("@@")) return "hunk";
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
      return "meta";
    }
    if (line.startsWith("+")) return "add";
    if (line.startsWith("-")) return "del";
    return "context";
  }

  const lines = $derived(
    diff.text
      ? diff.text.split("\n").map((text, index) => ({ id: index, text, kind: classify(text) }))
      : [],
  );
</script>

<section class="git-diff" aria-label={t("Git changes")}>
  <header>
    <span data-tooltip={diff.path}>{diff.path}</span>
    <small>{diff.staged ? t("Staged for commit") : t("Working copy")}</small>
    <button type="button" onclick={onEdit}>{t("Open file")}</button>
    <button type="button" aria-label={t("Close Git changes")} onclick={onClose}>
      <Icon name="x" size={14} />
    </button>
  </header>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (The diff scroll region is keyboard accessible.) -->
  <div class="diff-body" tabindex="0" role="region" aria-label={t("Diff text")}>
    {#if lines.length === 0}
      <p class="empty">{t("No text changes.")}</p>
    {:else}
      {#each lines as line (line.id)}
        <div class={`diff-line is-${line.kind}`}>{line.text || " "}</div>
      {/each}
    {/if}
  </div>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-inline: 12px 6px;
    min-height: 34px;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
  }
  header span {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono);
  }
  small {
    color: var(--muted);
    font-size: 11px;
  }
  button {
    min-width: 28px;
    min-height: 28px;
    padding-inline: 6px;
    border-radius: 4px;
    color: var(--text-2);
  }
  button:hover {
    background: var(--raised);
    color: var(--text);
  }
  .diff-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-block: 8px 20px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.6;
    tab-size: 2;
  }
  .diff-line {
    padding-inline: 16px;
    white-space: pre;
    min-width: max-content;
    color: var(--text-body);
  }
  .diff-line.is-add {
    background: color-mix(in srgb, var(--add) 12%, transparent);
    color: var(--add);
  }
  .diff-line.is-del {
    background: color-mix(in srgb, var(--del) 12%, transparent);
    color: var(--del);
  }
  .diff-line.is-hunk {
    background: var(--surface);
    color: var(--primary);
    padding-block: 4px;
    margin-block: 4px;
  }
  .diff-line.is-meta {
    color: var(--muted);
  }
  .empty {
    padding: 16px;
    color: var(--muted);
    font-family: var(--font);
  }
  @media (max-width: 600px) {
    small {
      display: none;
    }
  }
</style>
