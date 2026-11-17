<script lang="ts" generics="Value extends string | number | boolean | undefined">
  import { tick } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import FloatingMenu from "../FloatingMenu.svelte";
  import Icon from "../Icon.svelte";

  interface Props extends Omit<HTMLButtonAttributes, "value" | "onchange" | "onclick" | "onkeydown" | "children"> {
    value: Value;
    options: readonly { value: Value; label: string; disabled?: boolean; lang?: string }[];
    placeholder?: string;
    onchange?: (value: Value) => void;
  }
  const uid = $props.id();
  let { value = $bindable(), options, onchange, placeholder = "", id = uid,
    disabled = false, class: className = "", title, ...attributes }: Props = $props();
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let list = $state<HTMLDivElement>();
  let active = $state(-1);
  let label = $state("");
  let prefix = "";
  let lastTyped = 0;
  const selected = $derived(options.find((option) => option.value === value));
  const listId = `${uid}-list`;

  $effect(() => { if (disabled) open = false; });

  function close(restore = false): void {
    open = false;
    prefix = "";
    if (restore) trigger?.focus({ preventScroll: true });
  }

  function focus(index: number): void {
    active = index;
    void tick().then(() => {
      const option = list?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`);
      option?.focus({ preventScroll: true });
      option?.scrollIntoView({ block: "nearest" });
    });
  }

  async function show(edge?: "first" | "last"): Promise<void> {
    if (disabled) return;
    label = String(attributes["aria-label"] ?? trigger?.labels?.[0]?.textContent?.trim() ?? selected?.label ?? placeholder);
    open = true;
    await tick();
    const index = options.findIndex((option) => option.value === value && !option.disabled);
    const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
    focus((edge === "first" ? enabled[0] : edge === "last" ? enabled.at(-1) : index >= 0 ? index : enabled[0]) ?? -1);
    if (!enabled.length) list?.focus();
  }

  function choose(index: number): void {
    const option = options[index];
    if (disabled || !option || option.disabled) return;
    value = option.value;
    onchange?.(value);
    close(true);
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") { close(true); return; }
    const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
    if (!enabled.length) return;
    const position = enabled.indexOf(active);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = enabled[(position + 1) % enabled.length];
    else if (event.key === "ArrowUp") next = enabled[(position - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled.at(-1);
    else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = performance.now();
      prefix = now - lastTyped > 700 ? event.key : prefix + event.key;
      lastTyped = now;
      const needle = [...prefix].every((char) => char === prefix[0]) ? prefix.charAt(0) : prefix;
      const ordered = [...enabled.slice(position + 1), ...enabled.slice(0, position + 1)];
      next = ordered.find((index) => options[index]?.label.toLocaleLowerCase().startsWith(needle.toLocaleLowerCase()));
    } else return;
    event.preventDefault();
    if (next !== undefined) focus(next);
  }
</script>

<button {...attributes} {id} bind:this={trigger} type="button" role="combobox"
  class="custom-select {className}" class:is-open={open} value={String(value ?? "")}
  {disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
  data-tooltip={title ?? selected?.label ?? placeholder}
  onclick={() => open ? close() : void show()}
  onkeydown={(event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      void show(event.key === "Home" ? "first" : event.key === "End" ? "last" : undefined);
    } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      void show().then(() => keydown(event));
    }
  }}>
  <span class="custom-select-value">{selected?.label ?? value ?? placeholder}</span>
  <span class="custom-select-caret" aria-hidden="true"><Icon name="chevron-down" size={14} /></span>
</button>
{#if open}
  <FloatingMenu anchor={trigger} {label} preferred="below"
    width={Math.max(200, trigger?.getBoundingClientRect().width ?? 200)} maxHeight={280}
    onClose={() => close()} onkeydown={keydown}>
    <div class="custom-select-list" id={listId} bind:this={list} role="listbox" aria-label={label} tabindex="-1">
      {#each options as option, index (index)}
        <button type="button" role="option" tabindex="-1" aria-selected={option.value === value}
          disabled={option.disabled} lang={option.lang} data-value={String(option.value ?? "")} data-index={index}
          onfocus={() => active = index} onclick={() => choose(index)}>
          <span>{option.label}</span>
          <span class="custom-select-check" aria-hidden="true">{#if option.value === value}<Icon name="check" size={14} />{/if}</span>
        </button>
      {/each}
    </div>
  </FloatingMenu>
{/if}

<style>
  .custom-select { display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; text-align: start; cursor: default; }
  .custom-select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .custom-select-caret { display: flex; flex: none; color: var(--muted); transition: rotate 120ms var(--ease); }
  .is-open .custom-select-caret { rotate: 180deg; }
  .custom-select:disabled { opacity: 0.45; }
  .custom-select-list { padding: 4px; overflow-y: auto; overscroll-behavior: contain; }
  .custom-select-list button { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: var(--control-h); padding: 6px 8px; border-radius: 6px; color: var(--text-2); font-size: 13px; line-height: 1.4; text-align: start; overflow-wrap: anywhere; }
  .custom-select-list button:focus-visible { background: var(--raised); outline-offset: -2px; }
  .custom-select-list button[aria-selected="true"] { color: var(--text); }
  .custom-select-list button:disabled { opacity: 0.45; }
  .custom-select-check { display: grid; place-items: center; width: 16px; flex: none; }
  @media (hover: hover) { .custom-select-list button:hover:not(:disabled) { background: var(--raised); color: var(--text); } }
  @media (prefers-reduced-motion: reduce) { .custom-select-caret { transition: none; } }
  @media (forced-colors: active) { .custom-select-list button[aria-selected="true"] { border: 1px solid Highlight; } }
</style>
