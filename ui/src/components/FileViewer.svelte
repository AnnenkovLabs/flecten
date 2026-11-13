<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { modal } from "../lib/modal";
  import { formatBytes } from "../lib/composer/queue";
  import { lineNumbers, splitPath } from "../lib/file-text";
  import { fileViewer } from "../lib/file-viewer.svelte";
  import Icon from "./Icon.svelte";
  import CopyButton from "./CopyButton.svelte";

  const view = $derived(fileViewer.current);
  let bodyEl = $state<HTMLDivElement | null>(null);
  let wrap = $state(false);
  const numbers = $derived(view?.file ? lineNumbers(view.file.text) : "");
  const shown = $derived(view?.file?.path ?? view?.path ?? "");
  const parts = $derived(splitPath(shown));



  $effect(() => {
    // Opening a `read` with an offset lands on that line, not on the top of the file.
    const line = view?.line;
    const body = bodyEl;
    if (!line || !body || !view?.file) return;
    const height = Number.parseFloat(getComputedStyle(body).getPropertyValue("--line")) || 19;
    body.scrollTop = Math.max(0, (line - 3) * height);
  });

</script>

{#if view}
  <dialog
    class="viewer st-dialog"
    use:modal
    aria-labelledby="viewer-title"
    oncancel={(event) => {
      event.preventDefault();
      fileViewer.close();
    }}
  >
    <header class="head">
      <Icon name="file" size={15} />
      <h2 id="viewer-title" title={shown}>
        <span class="dir">{parts.dir}</span><span class="name">{parts.name}</span>
      </h2>
      {#if view.file && !view.file.binary}
        <span class="meta">{formatBytes(view.file.size)}</span>
        <button
          class="wrap"
          type="button"
          aria-pressed={wrap}
          title={t("Long lines wrap instead of scrolling horizontally")}
          onclick={() => (wrap = !wrap)}
        >
          {#if wrap}<Icon name="check" size={13} />{/if} {t("Word wrap")} </button>
      {/if}
      <CopyButton text={shown} label={t("Copy path")} />
      <button
        class="icon-btn"
        type="button"
        title={t("Close")}
        aria-label={t("Close preview")}
        onclick={() => fileViewer.close()}
      >
        <Icon name="x" size={15} />
      </button>
    </header>

    {#if view.loading}
      <p class="state" role="status">{t("Opening file…")}</p>
    {:else if view.error}
      <p class="state is-error" role="alert">{t("Could not open file: {0}", [view.error])}</p>
    {:else if view.file?.binary}
      <p class="state">{t("Binary file, {0}: no text to display.", [formatBytes(view.file.size)])}</p>
    {:else if view.file}
      {#if view.file.truncated}
        <p class="notice"> {t("Showing the start of the file: {0} of {1}.", [formatBytes(view.file.text.length), formatBytes(view.file.size)])} </p>
      {/if}
      <div class="body" class:is-wrapped={wrap} bind:this={bodyEl} tabindex="-1">
        <pre class="gutter" aria-hidden="true">{numbers}</pre>
        <pre class="code">{view.file.text}</pre>
      </div>
    {/if}
  </dialog>
{/if}

<style>
  .viewer {
    --line: 19px;
    display: none;
    width: min(980px, calc(100vw - 64px));
    height: min(760px, calc(100vh - 64px));
    border-radius: 16px;
    box-shadow:
      inset 0 0 0 1px var(--line-strong),
      0 32px 80px rgba(0, 0, 0, 0.45);
  }

  .viewer[open] {
    display: flex;
    flex-direction: column;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 12px 0 18px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
  }

  h2 {
    display: flex;
    flex: 1;
    min-width: 0;
    margin: 0;
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }

  .dir {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
  }

  .name {
    flex-shrink: 0;
    color: var(--text);
  }

  .meta {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    color: var(--text-2);
    font-size: 12px;
    white-space: nowrap;
    box-shadow: inset 0 0 0 1px var(--line);
    transition:
      background 260ms var(--ease),
      color 260ms var(--ease);
  }

  .wrap:hover {
    color: var(--text);
  }

  .wrap[aria-pressed="true"] {
    background: rgba(240, 239, 237, 0.08);
    color: var(--text);
  }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    color: var(--muted);
    transition: background 260ms var(--ease);
  }

  .icon-btn:hover {
    background: rgba(240, 239, 237, 0.06);
    color: var(--text);
  }

  .icon-btn:focus-visible,
  .wrap:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }

  .state,
  .notice {
    margin: 0;
    padding: 14px 18px;
    color: var(--text-2);
    font-size: 13px;
  }

  .state.is-error {
    color: var(--warning);
  }

  .notice {
    padding: 8px 18px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 12px;
  }

  .body {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    flex: 1;
    min-height: 0;
    overflow: auto;
    outline: 0;
  }

  pre {
    margin: 0;
    padding: 12px 0;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: var(--line);
    tab-size: 2;
  }

  .gutter {
    position: sticky;
    left: 0;
    z-index: 1;
    padding: 12px 12px 12px 18px;
    border-right: 1px solid var(--line);
    background: var(--bg);
    color: var(--muted);
    text-align: right;
    user-select: none;
  }

  .code {
    padding: 12px 18px;
    color: var(--text-body);
    white-space: pre;
  }

  .body.is-wrapped {
    grid-template-columns: minmax(0, 1fr);
  }

  .body.is-wrapped .gutter {
    display: none;
  }

  .body.is-wrapped .code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
