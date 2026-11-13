<script lang="ts" generics="Value extends string">
  import { tick } from "svelte";
  import type { IconName } from "../../lib/types";
  import FloatingMenu from "../FloatingMenu.svelte";
  import Icon from "../Icon.svelte";
  import MorphIcon from "../MorphIcon.svelte";

  interface Props {
    label: string;
    value: Value;
    options: readonly { value: Value; label: string; description?: string; icon?: IconName }[];
    disabled?: boolean;
    iconOnly?: boolean;
    onChange: (value: Value) => void;
  }
  let { label, value, options, disabled = false, iconOnly = false, onChange }: Props = $props();
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let list = $state<HTMLDivElement>();
  const id = $props.id();
  const selected = $derived(options.find((option) => option.value === value));
  const descriptive = $derived(options.some((option) => option.description));

  function close(focus = false): void {
    open = false;
    if (focus) trigger?.focus();
  }

  async function show(): Promise<void> {
    if (disabled) return;
    open = true;
    await tick();
    (list?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list?.querySelector<HTMLElement>('[role="option"]'))?.focus();
  }

  function choose(next: Value): void {
    onChange(next);
    close(true);
  }

  function keydown(event: KeyboardEvent): void {
    const buttons = [...(list?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (buttons.length === 0) return;
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    } else if (event.key === "Tab") {
      close(true);
      return;
    } else return;
    event.preventDefault();
    buttons[next]?.focus();
  }
</script>

<button
  class="composer-select"
  class:is-icon-only={iconOnly}
  class:is-open={open}
  bind:this={trigger}
  type="button"
  aria-label={`${label}: ${selected?.label ?? value}`}
  title={selected?.description ?? `${label}: ${selected?.label ?? value}`}
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={open ? id : undefined}
  {disabled}
  onclick={() => open ? close() : void show()}
  onkeydown={(event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      void show();
    }
  }}
>
  {#if selected?.icon}<MorphIcon name={selected.icon} size={14} />{/if}
  {#if !iconOnly}
    <span>{selected?.label ?? value}</span>
    <span class="caret"><Icon name="chevron-down" size={11} /></span>
  {/if}
</button>
{#if open}
  <FloatingMenu anchor={trigger} {label} width={descriptive ? 280 : 184} maxHeight={280} onClose={() => close()} onkeydown={keydown}>
    <div class="select-list" class:is-descriptive={descriptive} {id} bind:this={list} role="listbox" aria-label={label}>
      {#each options as option (option.value)}
        <button type="button" role="option" tabindex="-1" aria-selected={option.value === value} onclick={() => choose(option.value)}>
          {#if option.icon}<span class="option-icon"><Icon name={option.icon} size={17} /></span>{/if}
          <span class="option-copy">
            <span>{option.label}</span>
            {#if option.description}<span class="option-description">{option.description}</span>{/if}
          </span>
          <span class="option-check">{#if option.value === value}<Icon name="check" size={14} />{/if}</span>
        </button>
      {/each}
    </div>
  </FloatingMenu>
{/if}

<style>
  .composer-select {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    height: 32px;
    padding: 0 6px;
    border-radius: 6px;
    color: var(--muted);
    font-size: 12.5px;
  }
  .composer-select > span:not(.caret) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .composer-select.is-icon-only { flex: none; justify-content: center; width: 32px; padding: 0; }
  .composer-select:hover, .composer-select.is-open { background: var(--raised); color: var(--text-2); }
  .composer-select:disabled { opacity: 0.45; }
  .caret { display: flex; flex: none; transition: rotate 120ms var(--ease); }
  .composer-select.is-open .caret { rotate: 180deg; }
  .select-list { padding: 4px; overflow-y: auto; }
  .select-list button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    min-height: 40px;
    padding: 4px 8px;
    border-radius: 6px;
    color: var(--text-2);
    font-size: 13px;
    text-align: left;
  }
  .select-list button:hover, .select-list button:focus-visible { background: var(--raised); }
  .select-list button[aria-selected="true"] { color: var(--text); }
  .option-copy { display: grid; gap: 2px; min-width: 0; }
  .option-description { color: var(--muted); font-size: 12px; line-height: 1.4; }
  .option-icon, .option-check { display: grid; place-items: center; flex: none; width: 18px; }
  .is-descriptive button { align-items: start; min-height: 52px; padding-block: 8px; }
  .is-descriptive .option-copy { flex: 1; }
  .is-descriptive .option-copy > span:first-child { font-weight: 500; }
  .is-descriptive .option-icon, .is-descriptive .option-check { min-height: 18px; }
  @media (prefers-reduced-motion: reduce) { .caret { transition: none; } }
  @media (pointer: coarse) {
    .composer-select { height: 40px; }
    .select-list button { min-height: 40px; }
  }
</style>
