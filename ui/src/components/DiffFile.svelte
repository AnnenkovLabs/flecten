<script module lang="ts">
  import type { DiffFile as DiffFileType, DiffLine } from "../lib/types";

  export function toggleFoldedHunk(
    folded: Record<number, boolean>,
    index: number,
  ): Record<number, boolean> {
    return { ...folded, [index]: !folded[index] };
  }

  export function hunkStat(lines: DiffLine[]): { add: number; del: number } {
    let add = 0;
    let del = 0;
    for (const line of lines) {
      if (line.kind === "add") add += 1;
      else if (line.kind === "del") del += 1;
    }
    return { add, del };
  }

  export function patchText(file: DiffFileType): string {
    if (file.hunks.length === 0) return "";
    const state = String(file.state);
    const from = state === "A" ? "/dev/null" : `a/${file.path}`;
    const to = state === "D" ? "/dev/null" : `b/${file.path}`;
    const lines = [`--- ${from}`, `+++ ${to}`];
    for (const hunk of file.hunks) {
      lines.push(hunk.header);
      for (const line of hunk.lines) {
        const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
        lines.push(`${prefix}${line.text}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
</script>

<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { fileViewer } from "../lib/file-viewer.svelte";
  import { expandable } from "../lib/motion";
  import FileTypeBadge from "./FileTypeBadge.svelte";
  import Icon from "./Icon.svelte";
  import CopyButton from "./CopyButton.svelte";

  let { file }: { file: DiffFileType } = $props();
  let collapsed = $state(false);
  let foldedHunks = $state<Record<number, boolean>>({});

  const bodyId = $derived(`diff-body-${file.path.replace(/[^a-z0-9]+/gi, "-")}`);
  const fileState = $derived(String(file.state));
  const stateLabel = $derived(
    fileState === "A"
      ? t("Added")
      : fileState === "D"
        ? t("Deleted")
        : fileState === "R"
          ? t("Renamed")
          : t("Modified"),
  );
  const stateClass = $derived(
    fileState === "A"
      ? "is-added"
      : fileState === "D"
        ? "is-deleted"
        : fileState === "R"
          ? "is-renamed"
          : "is-modified",
  );
  const hasHunks = $derived(file.hunks.length > 0);

</script>

<article class="diff-file" class:is-collapsed={collapsed}>
  <header class="diff-head">
    <FileTypeBadge kind={file.kind} />
    <span class="diff-path" title={file.path}>{file.path}</span>
    <span class="file-state {stateClass}" title={stateLabel}>{fileState}</span>
    <span class="add">+{file.add}</span>
    {#if file.del}
      <span class="del">−{file.del}</span>
    {/if}
    {#if fileState !== "D"}
      <button
        class="head-btn"
        type="button"
        aria-label={t("Open file")}
        title={t("Open file in the built-in viewer")}
        onclick={() => void fileViewer.open(file.path)}
      >
        <Icon name="file" size={13} />
      </button>
    {/if}
    <CopyButton text={() => patchText(file)} label={t("Copy file patch")} disabled={!hasHunks} />
    <button
      class="file-toggle"
      type="button"
      aria-label={collapsed ? t("Expand file") : t("Collapse file")}
      aria-expanded={!collapsed}
      aria-controls={bodyId}
      title={collapsed ? t("Expand file") : t("Collapse file")}
      onclick={() => (collapsed = !collapsed)}
    >
      <span class="file-chevron" class:is-collapsed={collapsed}>
        <Icon name="chevron-down" size={14} />
      </span>
    </button>
  </header>

  <div class="diff-body" id={bodyId} use:expandable={!collapsed}>
    {#if !hasHunks}
      <p class="diff-empty">
        {fileState === "D"
          ? t("File deleted. No text diff available.")
          : t("Binary file or empty change: no text diff available.")}
      </p>
    {:else}
      {#each file.hunks as hunk, index (index)}
        {@const folded = foldedHunks[index] === true}
        {@const stat = hunkStat(hunk.lines)}
        <button
          class="hunk-head"
          class:is-folded={folded}
          type="button"
          aria-expanded={!folded}
          aria-controls={`${bodyId}-hunk-${index}`}
          onclick={() => (foldedHunks = toggleFoldedHunk(foldedHunks, index))}
        >
          <span class="hunk-chevron" class:is-folded={folded}>
            <Icon name="chevron-down" size={12} />
          </span>
          <span class="hunk-title" title={hunk.header}>{hunk.header}</span>
          <span class="hunk-stat">
            <span class="add">+{stat.add}</span>
            <span class="del">−{stat.del}</span>
          </span>
        </button>
        {#if !folded}
          <div class="hunk-lines" id={`${bodyId}-hunk-${index}`}>
            {#each hunk.lines as line, lineIndex (`${index}-${lineIndex}`)}
              <div class="dl {line.kind}">
                <span class="ln">{line.oldLine ?? ""}</span>
                <span class="ln">{line.newLine ?? ""}</span>
                <span class="mark" aria-hidden="true">
                  {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
                </span>
                <span class="lt">{line.text}</span>
              </div>
            {/each}
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</article>

<style>
  .diff-head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 6px 0 16px;
    background: var(--panel);
    color: var(--muted);
    font-size: 12px;
  }

  .diff-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-2);
    font-family: var(--mono);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-state {
    display: grid;
    place-items: center;
    width: 17px;
    height: 17px;
    flex: none;
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 700;
  }

  .file-state.is-modified {
    background: rgba(211, 189, 145, 0.12);
    color: var(--warning);
  }

  .file-state.is-added {
    background: rgba(178, 185, 175, 0.12);
    color: var(--success);
  }

  .file-state.is-deleted {
    background: rgba(226, 162, 162, 0.12);
    color: var(--error);
  }

  .file-state.is-renamed {
    background: rgba(240, 239, 237, 0.08);
    color: var(--text-2);
  }

  .head-btn,
  .file-toggle {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 6px;
    color: var(--muted);
    transition:
      background 240ms var(--ease),
      color 240ms var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .head-btn:hover,
  .file-toggle:hover {
    border-radius: 9px;
    background: rgba(240, 239, 237, 0.06);
    color: var(--text-2);
  }

  .head-btn:focus-visible,
  .file-toggle:focus-visible,
  .hunk-head:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .file-chevron,
  .hunk-chevron {
    display: grid;
    place-items: center;
    transition: transform 460ms var(--ease-jelly);
  }

  .file-chevron.is-collapsed,
  .hunk-chevron.is-folded {
    transform: rotate(-90deg);
  }

  .diff-body {
    overflow-x: auto;
    overflow-y: clip;
    overscroll-behavior-x: contain;
  }

  .hunk-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 4px 14px 4px 10px;
    background: rgba(240, 239, 237, 0.035);
    color: #8b8f94;
    font-family: var(--mono);
    font-size: 12px;
    text-align: left;
    transition: background 180ms var(--ease);
  }

  .hunk-head:hover {
    background: rgba(240, 239, 237, 0.06);
  }

  .hunk-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hunk-stat {
    display: flex;
    gap: 6px;
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  .hunk-lines {
    width: max-content;
    min-width: 100%;
  }

  .dl {
    display: grid;
    grid-template-columns: 46px 46px 18px max-content;
    width: max-content;
    min-width: 100%;
    min-height: 21px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.7;
    tab-size: 2;
  }

  .ln {
    padding-right: 9px;
    color: #6f6c68;
    text-align: right;
    user-select: none;
  }

  .mark {
    color: var(--muted);
    text-align: center;
    user-select: none;
  }

  .lt {
    padding-left: 8px;
    padding-right: 18px;
    color: var(--text-2);
    white-space: pre;
  }

  .dl.add {
    background: rgba(88, 140, 92, 0.1);
  }

  .dl.add .lt {
    color: #bacbb5;
  }

  .dl.add .mark {
    color: var(--add);
    font-weight: 700;
  }

  .dl.del {
    background: rgba(160, 80, 80, 0.1);
  }

  .dl.del .lt {
    color: #d6b4b4;
  }

  .dl.del .mark {
    color: var(--del);
    font-weight: 700;
  }

  .diff-empty {
    padding: 18px 16px 22px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.55;
  }

  @media (prefers-reduced-motion: reduce) {
    .file-chevron,
    .hunk-chevron,
    .head-btn,
    .file-toggle {
      transition: none;
    }

  }
</style>
