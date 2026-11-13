<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { ideCommands, type CommandId } from "../../lib/ide/commands";
  import Icon from "../Icon.svelte";
  let { onExecute }: { onExecute: (id: CommandId) => void } = $props();
  const commands = $derived(ideCommands());
  const groups = $derived([...new Set(commands.map((command) => command.group))]);
  let menu: HTMLDivElement;
  let group = $state(t("File"));
  let left = $state(0);
  let top = $state(0);
  function open(event: MouseEvent, name: string): void {
    group = name;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    left = Math.max(8, Math.min(rect.left, window.innerWidth - 320)); top = rect.bottom;
    menu.showPopover(); queueMicrotask(() => menu.querySelector("button")?.focus());
  }
  function keydown(event: KeyboardEvent): void {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll("button")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }
</script>
<nav class="ide-menu" aria-label="{t("IDE menu")}">
  {#each groups as name}<button type="button" onclick={(event) => open(event, name)}>{name}</button>{/each}
  <button class="compact-menu" type="button" aria-label="{t("IDE command menu")}" onclick={() => onExecute("palette")}><Icon name="more" size={16} /></button>
</nav>
<div class="ide-menu-popover" role="menu" tabindex="-1" aria-label={group} popover="auto" bind:this={menu} style:top={`${top}px`} style:left={`${left}px`} onkeydown={keydown}>
  {#each commands.filter((command) => command.group === group) as command (command.id)}<button type="button" role="menuitem" onclick={() => { menu.hidePopover(); onExecute(command.id); }}><span>{command.label}</span><kbd>{command.shortcut}</kbd></button>{/each}
</div>
<style>
  nav { display: flex; align-items: center; gap: 2px; min-width: 0; } nav > button { min-height: 28px; padding-inline: 8px; font-size: 12px; border-radius: 4px; color: var(--text-2); white-space: nowrap; } nav > button:hover { background: var(--raised); color: var(--text); } .compact-menu { display: none; }
  .ide-menu-popover { position: fixed; margin: 2px 0 0; padding: 4px; width: min(320px, calc(100vw - 16px)); max-height: calc(100dvh - 130px); overflow: auto; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--raised); color: var(--text-2); box-shadow: 0 8px 24px #0005; } .ide-menu-popover button { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 30px; padding: 4px 8px; border-radius: 3px; font-size: 12px; text-align: start; } .ide-menu-popover button:hover { background: var(--raised-hover); } kbd { flex: none; font-size: 11px; color: var(--muted); }
  @media (max-width: 1100px) { nav > button { display: none; } nav > .compact-menu { display: grid; place-items: center; } }

  @container ide-editor (max-width: 760px) { nav > button { display: none; } nav > .compact-menu { display: grid; place-items: center; } }
</style>
