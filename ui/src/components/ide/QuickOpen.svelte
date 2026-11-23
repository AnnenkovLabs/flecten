<script lang="ts">
  import { splitPath } from "../../lib/file-text";
  import { t } from "../../lib/i18n.svelte";
  import { type CommandId, ideCommands } from "../../lib/ide/commands";
  import { fileIcon } from "../../lib/ide/editor";
  import {
    highlightSnippet,
    parseLineTarget,
    parseQuickQuery,
    type QuickTextMatch,
    searchQuickText,
  } from "../../lib/ide/quick-search";
  import { modal } from "../../lib/modal";
  import Icon from "../Icon.svelte";

  let {
    files,
    recent = [],
    mode = "files",
    activePath = null,
    onOpen,
    onOpenLocation,
    onExecute,
    onClose,
  }: {
    files: string[];
    recent?: string[];
    mode?: "files" | "commands";
    activePath?: string | null;
    onOpen: (path: string) => void;
    onOpenLocation: (path: string, line: number, column: number, length: number) => void;
    onExecute: (id: CommandId) => void;
    onClose: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let query = $state("");
  let selected = $state(0);
  let textMatches = $state<QuickTextMatch[]>([]);
  let textLimited = $state(false);
  let textBusy = $state(false);
  let textError = $state<string | null>(null);
  let searchTicket = 0;

  const parsed = $derived(parseQuickQuery(query, mode));
  const title = $derived(
    parsed.kind === "commands"
      ? t("Command palette")
      : parsed.kind === "text"
        ? t("Search in code")
        : t("Open file"),
  );

  const lineTarget = $derived(parsed.kind === "line" ? parseLineTarget(parsed.term) : null);

  $effect(() => {
    if (parsed.kind !== "text") {
      searchTicket += 1;
      textMatches = [];
      textLimited = false;
      textBusy = false;
      textError = null;
      return;
    }
    const term = parsed.term;
    if (!term) {
      searchTicket += 1;
      textMatches = [];
      textLimited = false;
      textBusy = false;
      textError = null;
      return;
    }
    const ticket = ++searchTicket;
    textBusy = true;
    textError = null;
    const timer = setTimeout(() => {
      void searchQuickText(term, 80)
        .then((result) => {
          if (ticket !== searchTicket) return;
          textMatches = result.matches;
          textLimited = result.limited;
          selected = 0;
        })
        .catch((error: unknown) => {
          if (ticket !== searchTicket) return;
          textError = error instanceof Error ? error.message : String(error);
          textMatches = [];
        })
        .finally(() => {
          if (ticket === searchTicket) textBusy = false;
        });
    }, 140);
    return () => clearTimeout(timer);
  });

  const staticMatches = $derived.by(() => {
    const text = parsed.term.toLocaleLowerCase();
    if (parsed.kind === "commands") {
      return ideCommands()
        .filter((command) => `${command.group} ${command.label}`.toLocaleLowerCase().includes(text))
        .map((command) => ({
          id: command.id,
          name: command.label,
          detail: command.group,
          shortcut: command.shortcut,
        }));
    }
    if (parsed.kind !== "files") return [];
    const paths = [...new Set([...recent, ...files])];
    return paths
      .filter((path) => path.toLocaleLowerCase().includes(text))
      .sort((a, b) => {
        if (!text) return 0;
        return (
          Number(splitPath(b).name.toLocaleLowerCase().startsWith(text)) -
          Number(splitPath(a).name.toLocaleLowerCase().startsWith(text))
        );
      })
      .slice(0, 100)
      .map((path) => ({
        id: path,
        name: splitPath(path).name,
        detail: splitPath(path).dir,
        shortcut: recent.includes(path) ? t("open") : "",
      }));
  });

  const resultCount = $derived(
    parsed.kind === "text"
      ? textMatches.length
      : parsed.kind === "line"
        ? lineTarget && activePath
          ? 1
          : 0
        : staticMatches.length,
  );

  function choose(index: number): void {
    if (parsed.kind === "line") {
      if (!lineTarget || !activePath) return;
      const targetPath = activePath;
      const { line, column } = lineTarget;
      onClose();
      setTimeout(() => onOpenLocation(targetPath, line, column, 0), 0);
      return;
    }
    if (parsed.kind === "text") {
      const hit = textMatches[index];
      if (!hit) return;
      onClose();
      setTimeout(() => onOpenLocation(hit.path, hit.line, hit.column, hit.length), 0);
      return;
    }
    const match = staticMatches[index];
    if (!match) return;
    const apply =
      parsed.kind === "files" ? () => onOpen(match.id) : () => onExecute(match.id as CommandId);
    onClose();
    setTimeout(apply, 0);
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (resultCount === 0) return;
      selected = Math.max(0, Math.min(resultCount - 1, selected + (event.key === "ArrowDown" ? 1 : -1)));
      dialog.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(selected);
    }
  }
</script>

<dialog
  bind:this={dialog}
  use:modal={() => input}
  class="quick-open"
  aria-label={title}
  oncancel={(event) => {
    event.preventDefault();
    onClose();
  }}
  onkeydown={keydown}
>
  <label>
    <Icon name={parsed.kind === "commands" ? "terminal" : "search"} size={16} />
    <input
      bind:this={input}
      bind:value={query}
      oninput={() => (selected = 0)}
      placeholder={mode === "commands"
        ? t("Enter a command name…")
        : t("File name, % search in code, > commands")}
      aria-label={mode === "commands" ? t("Command name") : t("File name")}
      aria-controls="quick-files"
      aria-activedescendant={resultCount > 0 ? `quick-result-${selected}` : undefined}
      role="combobox"
      aria-expanded="true"
      aria-autocomplete="list"
    />
    <button type="button" aria-label={t("Close file search")} onclick={onClose}>
      <Icon name="x" size={15} />
    </button>
  </label>

  <div class="quick-caption">
    <span>
      {#if parsed.kind === "text"}
        {textBusy ? t("Searching…") : t("Search in code")}
      {:else if parsed.kind === "commands"}
        {t("IDE commands")}
      {:else if parsed.kind === "line"}
        {t("Go to line")}
      {:else}
        {parsed.term ? t("Project files") : t("Open files and project")}
      {/if}
    </span>
    <span>{resultCount}{textLimited && parsed.kind === "text" ? "+" : ""}</span>
  </div>

  <div class="results" id="quick-files" role="listbox" aria-label={title}>
    {#if parsed.kind === "text"}
      {#if textError}
        <p role="alert">{textError}</p>
      {:else if !parsed.term}
        <p>{t("Type text after % to search across project code")}</p>
      {:else if textBusy && textMatches.length === 0}
        <p role="status">{t("Searching…")}</p>
      {:else if textMatches.length === 0}
        <p>{t("No matches. Change the search text or remove the path filter.")}</p>
      {:else}
        {#each textMatches as hit, index (`${hit.path}:${hit.line}:${hit.column}:${index}`)}
          {@const snippet = highlightSnippet(hit.text, parsed.term)}
          {@const parts = splitPath(hit.path)}
          <button
            role="option"
            aria-selected={selected === index}
            id={`quick-result-${index}`}
            class="text-hit"
            class:selected={selected === index}
            data-index={index}
            type="button"
            data-tooltip={`${hit.path}:${hit.line}:${hit.column}`}
            onclick={() => choose(index)}
          >
            <div class="hit-head">
              <span class="file-tint" style:color={fileIcon(hit.path).color}><Icon name="file" size={13} /></span>
              <span class="hit-file">{parts.name}</span>
              <span class="hit-loc">:{hit.line}</span>
              {#if parts.dir}<small>{parts.dir}</small>{/if}
            </div>
            <code class="hit-code">{snippet.before}{#if snippet.match}<mark>{snippet.match}</mark>{/if}{snippet.after}</code>
          </button>
        {/each}
      {/if}
    {:else if parsed.kind === "line"}
      {#if lineTarget && activePath}
        <button
          role="option"
          aria-selected="true"
          id="quick-result-0"
          class="selected"
          data-index="0"
          type="button"
          onclick={() => choose(0)}
        >
          <Icon name="chevron-right" size={14} />
          <span class="result-name">{t("Ln {0}, Col {1}", [lineTarget.line, lineTarget.column])}<small>{activePath}</small></span>
        </button>
      {:else}
        <p>{t("Enter a line number or line:column. Press Enter to go, Esc to cancel.")}</p>
      {/if}
    {:else}
      {#each staticMatches as match, index (match.id)}
        <button
          role="option"
          aria-selected={selected === index}
          id={`quick-result-${index}`}
          class:selected={selected === index}
          data-index={index}
          type="button"
          data-tooltip={parsed.kind === "files" ? match.id : `${match.detail}: ${match.name}`}
          onclick={() => choose(index)}
        >
          <span class="file-tint" style:color={parsed.kind === "files" ? fileIcon(match.id).color : undefined}>
            <Icon name={parsed.kind === "files" ? "file" : "chevron-right"} size={14} />
          </span>
          <span class="result-name">{match.name}<small>{match.detail}</small></span>
          {#if match.shortcut}<kbd>{match.shortcut}</kbd>{/if}
        </button>
      {/each}
      {#if staticMatches.length === 0}
        <p>{t("No results found. Change your search.")}</p>
      {/if}
    {/if}
  </div>

  <footer>
    <span>{t("↑ ↓ select")}</span>
    <span>{t("Enter open")}</span>
    <span>{t("Esc close")}</span>
    {#if mode === "files"}
      <span class="prefix-hints"><kbd>%</kbd> {t("code")} · <kbd>&gt;</kbd> {t("commands")}</span>
    {/if}
  </footer>
</dialog>

<style>
  dialog { top: 64px; margin: 0 auto; padding: 6px; width: min(680px, calc(100vw - 32px)); border: 1px solid var(--line-strong); border-radius: 8px; background: var(--raised); color: var(--text); box-shadow: 0 14px 44px #0008; }
  dialog::backdrop { background: #0005; }
  label { display: flex; align-items: center; gap: 10px; padding: 4px 6px 8px 10px; color: var(--muted); }
  input { flex: 1; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: 5px; background: var(--bg); font-size: 13.5px; color: var(--text); }
  label button { width: 28px; height: 32px; }
  .quick-caption { display: flex; justify-content: space-between; padding: 2px 12px 6px; color: var(--muted); font-size: 11.5px; }
  .results { max-height: min(440px, calc(100dvh - 230px)); overflow: auto; }
  .results button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 32px; padding: 5px 10px; border-radius: 5px; color: var(--text-2); text-align: start; font-size: 13px; }
  .results button.text-hit { flex-direction: column; align-items: stretch; gap: 3px; padding: 6px 10px; }
  .hit-head { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
  .hit-file { color: var(--text); font-weight: 500; flex: none; }
  .hit-loc { color: var(--primary); font-family: var(--mono); font-size: 11px; flex: none; }
  .hit-code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-2); padding-inline-start: 19px; }
  .hit-code mark { background: color-mix(in srgb, var(--primary) 30%, transparent); color: var(--text); border-radius: 2px; padding: 0 1px; }
  .file-tint { display: inline-flex; align-items: center; flex: none; }
  .results button.selected, .results button:hover { background: var(--raised-hover); color: var(--text); }
  .result-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { color: var(--muted); font-size: 11.5px; margin-inline-start: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  kbd { color: var(--muted); font-size: 11px; flex: none; }
  p { padding: 18px 12px; color: var(--muted); font-size: 13px; }
  footer { display: flex; align-items: center; gap: 14px; padding: 8px 12px 4px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
  .prefix-hints { margin-inline-start: auto; }
</style>
