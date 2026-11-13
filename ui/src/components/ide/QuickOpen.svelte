<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { modal } from "../../lib/modal";
  import { ideCommands, type CommandId } from "../../lib/ide/commands";
  import { splitPath } from "../../lib/file-text";
  import Icon from "../Icon.svelte";
  let { files, recent = [], mode = "files", onOpen, onExecute, onClose }: { files: string[]; recent?: string[]; mode?: "files" | "commands"; onOpen: (path: string) => void; onExecute: (id: CommandId) => void; onClose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let query = $state("");
  let selected = $state(0);
  const title = $derived(mode === "files" ? t("Open file") : t("Command palette"));
  const matches = $derived.by(() => {
    const text = query.trim().toLocaleLowerCase();
    if (mode === "commands") return ideCommands().filter((command) => `${command.group} ${command.label}`.toLocaleLowerCase().includes(text)).map((command) => ({ id: command.id, name: command.label, detail: command.group, shortcut: command.shortcut }));
    const paths = [...new Set([...recent, ...files])];
    return paths.filter((path) => path.toLocaleLowerCase().includes(text)).sort((a, b) => {
      if (!text) return 0;
      return Number(splitPath(b).name.toLocaleLowerCase().startsWith(text)) - Number(splitPath(a).name.toLocaleLowerCase().startsWith(text));
    }).slice(0, 100).map((path) => ({ id: path, name: splitPath(path).name, detail: splitPath(path).dir, shortcut: recent.includes(path) ? t("open") : "" }));
  });
  function choose(index: number): void {
    const match = matches[index]; if (!match) return;
    const apply = mode === "files" ? () => onOpen(match.id) : () => onExecute(match.id as CommandId);
    onClose();
    // The modal restores its opener in a microtask. Run commands after that restoration.
    setTimeout(apply, 0);
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); selected = Math.max(0, Math.min(matches.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1)));
      dialog.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") { event.preventDefault(); choose(selected); }
  }
</script>
<dialog bind:this={dialog} use:modal={() => input} class="quick-open" aria-label={title} oncancel={(event) => { event.preventDefault(); onClose(); }} onkeydown={keydown}>
  <label><Icon name={mode === "files" ? "search" : "terminal"} size={17} /><input bind:this={input} bind:value={query} oninput={() => selected = 0} placeholder={mode === "files" ? t("Enter a file name…") : t("Enter a command name…")} aria-label={mode === "files" ? t("File name") : t("Command name")} aria-controls="quick-files" aria-activedescendant={matches[selected] ? `quick-result-${selected}` : undefined} role="combobox" aria-expanded="true" aria-autocomplete="list" /><button type="button" aria-label={t("Close file search")} onclick={onClose}><Icon name="x" size={15} /></button></label>
  <div class="quick-caption">{mode === "files" ? query ? t("Project files") : t("Open files and project") : t("IDE commands")}<span>{matches.length}</span></div>
  <div class="results" id="quick-files" role="listbox" aria-label={title}>
    {#each matches as match, index (match.id)}<button role="option" aria-selected={selected === index} id={`quick-result-${index}`} class:selected={selected === index} data-index={index} type="button" title={mode === "files" ? match.id : `${match.detail}: ${match.name}`} onclick={() => choose(index)}><Icon name={mode === "files" ? "file" : "chevron-right"} size={14} /><span class="result-name">{match.name}<small>{match.detail}</small></span>{#if match.shortcut}<kbd>{match.shortcut}</kbd>{/if}</button>{/each}
    {#if matches.length === 0}<p>{t("No results found. Change your search.")}</p>{/if}
  </div>
  <footer><span>{t("↑ ↓ select")}</span><span>{t("Enter open")}</span><span>{t("Esc close")}</span></footer>
</dialog>
<style>
  dialog { top: 72px; margin: 0 auto; padding: 6px; width: min(640px, calc(100vw - 32px)); border: 1px solid var(--line-strong); border-radius: 8px; background: var(--raised); color: var(--text); box-shadow: 0 12px 40px #0007; }
  dialog::backdrop { background: #0005; } label { display: flex; align-items: center; gap: 10px; padding: 4px 6px 8px 10px; color: var(--muted); } input { flex: 1; min-width: 0; height: 36px; padding: 0 8px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--bg); font-size: 14px; } label button { width: 28px; height: 32px; }
  .quick-caption { display: flex; justify-content: space-between; padding: 4px 12px 8px; color: var(--muted); font-size: 12px; } .results { max-height: min(420px, calc(100dvh - 240px)); overflow: auto; } .results button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 6px 10px; border-radius: 4px; color: var(--text-2); text-align: start; font-size: 13px; } .results button.selected, .results button:hover { background: var(--raised-hover); color: var(--text); } .result-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { color: var(--muted); font-size: 12px; margin-inline-start: 12px; } kbd { color: var(--muted); font-size: 11px; flex: none; } p { padding: 18px 12px; color: var(--muted); font-size: 13px; } footer { display: flex; gap: 16px; padding: 10px 12px 4px; color: var(--muted); font-size: 11px; }
</style>
