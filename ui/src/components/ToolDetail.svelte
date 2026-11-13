<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { fileViewer } from "../lib/file-viewer.svelte";
  import type { DiffHunk, RunAction } from "../lib/types";
  import CopyButton from "./CopyButton.svelte";
  import SubagentDetail from "./SubagentDetail.svelte";

  let { action }: { action: RunAction } = $props();

  const detail = $derived(action.detail);
  const input = $derived(formatValue(detail?.input));
  const output = $derived(detail?.output ?? "");
  const error = $derived(detail?.error ?? "");
  const patch = $derived(formatHunks(detail?.hunks ?? []));
  const hasBody = $derived(
    input.length > 0 ||
      output.length > 0 ||
      error.length > 0 ||
      patch.length > 0 ||
      detail?.fullOutputPath !== undefined ||
      detail?.file !== undefined ||
      detail?.exitCode !== undefined,
  );

  function formatValue(value: unknown): string {
    if (value === undefined) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function formatHunks(hunks: DiffHunk[]): string {
    return hunks
      .map((hunk) =>
        [
          hunk.header,
          ...hunk.lines.map(
            (line) =>
              `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`,
          ),
        ].join("\n"),
      )
      .join("\n");
  }

</script>

{#if hasBody}
  <div class="detail">
    {#if detail?.exitCode !== undefined ||
      detail?.fullOutputPath ||
      detail?.file}
      <div class="detail-meta">
        {#if detail?.exitCode !== undefined}
          <span class:is-failed={detail.exitCode !== 0}>{t("Exit code {0}", [detail.exitCode])}</span>
        {/if}
        {#if detail?.file && !action.failed}
          {@const file = detail.file}
          <button
            class="detail-link"
            type="button"
            title={t("Open {0} in the built-in viewer", [file])}
            onclick={() => void fileViewer.open(file, detail.line)}
          > {t("Open file")} </button>
        {/if}
        {#if detail?.fullOutputPath}
          {@const log = detail.fullOutputPath}
          <button
            class="detail-link"
            type="button"
            title={log}
            onclick={() => void fileViewer.open(log)}
          > {t("Full log")} </button>
        {/if}
      </div>
    {/if}

    {#if error}
      <section class="detail-section">
        <span class="detail-label">{t("Error")}</span>
        <pre class="code scroll error-text">{error}</pre>
      </section>
    {/if}

    {#if action.tool === "task"}
      <SubagentDetail {action} />
    {:else if action.subject}
      <p class="detail-subject">{action.subject}</p>
    {/if}

    {#if output && action.tool !== "task"}
      <section class="detail-section">
        <div class="detail-head">
          <span class="detail-label">{t("Output")}</span>
          <CopyButton text={output} label={t("Copy output")} caption={t("Copy")} />
        </div>
        <pre class="code scroll">{output}</pre>
      </section>
    {/if}

    {#if input || action.tool}
      <details class="technical">
        <summary>{t("Technical details")}</summary>
        {#if action.tool}<p class="tool-name">{t("Tool: {0}", [action.tool])}</p>{/if}
        {#if input}
          <section class="detail-section"><span class="detail-label">{t("Arguments")}</span><pre class="code scroll">{input}</pre></section>
        {/if}
        {#if output && action.tool === "task"}
          <section class="detail-section"><span class="detail-label">{t("Full response")}</span><pre class="code scroll">{output}</pre></section>
        {/if}
      </details>
    {/if}

    {#if patch}
      <section class="detail-section">
        <div class="detail-head">
          <span class="detail-label">{t("Patch")}</span>
          <CopyButton text={patch} label={t("Copy patch")} caption={t("Copy")} />
        </div>
        <div class="patch scroll">
          {#each detail?.hunks ?? [] as hunk, hunkIndex (hunkIndex)}
            <div class="hunk">{hunk.header}</div>
            {#each hunk.lines as line, lineIndex (lineIndex)}
              <div class="line" class:add={line.kind === "add"} class:del={line.kind === "del"}><span
                  class="mark">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>{line.text}</div>
            {/each}
          {/each}
        </div>
      </section>
    {/if}
  </div>
{/if}

<style>
  .detail {
    display: grid;
    gap: 10px;
    padding: 8px 10px 10px 29px;
  }

  .detail-subject { margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
  .technical summary { min-height: 40px; align-content: center; color: var(--muted); font-size: 12px; cursor: pointer; }
  .technical summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
  .technical section + section { margin-top: 12px; }
  .tool-name { margin: 0 0 8px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }

  .detail-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
  }

  .detail-meta .is-failed {
    color: var(--warning);
  }

  .detail-link {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    color: var(--text-2);
    font-size: 12px;
    text-decoration: underline;
    text-decoration-color: rgba(240, 239, 237, 0.24);
    text-underline-offset: 3px;
    transition:
      color 200ms var(--ease),
      text-decoration-color 200ms var(--ease);
  }

  .detail-link:hover {
    color: var(--text);
    text-decoration-color: currentColor;
  }

  .detail-link:focus-visible {
    border-radius: 4px;
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .detail-section {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .detail-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .detail-label {
    flex: 1;
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
  }

  .code {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: rgba(240, 239, 237, 0.035);
    color: var(--text-2);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .scroll {
    max-height: 260px;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .error-text {
    background: rgba(226, 162, 162, 0.07);
    color: var(--error);
  }

  .patch {
    padding: 6px 0;
    border-radius: 6px;
    background: rgba(240, 239, 237, 0.035);
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.55;
  }

  .hunk {
    padding: 2px 10px;
    color: var(--muted);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .line {
    padding: 0 10px;
    color: var(--text-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .mark {
    user-select: none;
  }

  .line.add {
    color: var(--add);
  }

  .line.del {
    color: var(--del);
  }

</style>
