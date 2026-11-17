<script lang="ts">
  import { tick } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";
  import FloatingMenu from "../FloatingMenu.svelte";
  import Icon from "../Icon.svelte";

  interface Props extends Omit<HTMLInputAttributes, "value" | "type" | "list" | "oninput" | "onfocus" | "onblur" | "onkeydown" | "onclick"> {
    value: string;
    options: readonly { value: string; label: string; lang?: string }[];
  }
  const uid = $props.id();
  let { value = $bindable(), options, disabled = false, class: className = "", ...attributes }: Props = $props();
  let input = $state<HTMLInputElement | null>(null);
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  let query = $state("");
  let active = $state(-1);
  const filtered = $derived(options.filter((option) => {
    const needle = query.trim().toLocaleLowerCase();
    return option.value.toLocaleLowerCase().includes(needle) || option.label.toLocaleLowerCase().includes(needle);
  }));
  const expanded = $derived(open && filtered.length > 0);
  const listId = `${uid}-options`;
  const label = $derived(String(attributes["aria-label"] ?? input?.labels?.[0]?.textContent?.trim() ?? ""));

  $effect(() => { if (disabled) open = false; });

  function close(): void { open = false; active = -1; }

  function show(): void {
    if (disabled) return;
    query = "";
    open = true;
    active = options.findIndex((option) => option.value === value);
  }

  function move(index: number): void {
    active = index;
    void tick().then(() => list?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  function choose(index: number): void {
    const option = filtered[index];
    if (!option || disabled) return;
    value = option.value;
    close();
    input?.focus({ preventScroll: true });
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") close();
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show();
      else if (filtered.length) move(active < 0 ? (event.key === "ArrowDown" ? 0 : filtered.length - 1) : (active + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length);
    } else if (event.key === "Enter" && expanded && active >= 0) {
      event.preventDefault();
      choose(active);
    }
  }
</script>

<div class="combobox-field">
  <input {...attributes} bind:this={input} type="text" role="combobox"
    class="custom-combobox {className}" {value} {disabled} autocomplete="off"
    aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={expanded}
    aria-controls={expanded ? listId : undefined}
    aria-activedescendant={expanded && active >= 0 ? `${uid}-option-${active}` : undefined}
    oninput={(event) => { value = event.currentTarget.value; query = value; open = true; active = -1; }}
    onfocus={show} onclick={() => { if (!open) show(); }} onblur={close} onkeydown={keydown} />
  <span class="combobox-caret" aria-hidden="true"><Icon name="chevron-down" size={14} /></span>
</div>
{#if expanded}
  <FloatingMenu anchor={input} {label} preferred="below"
    width={Math.max(200, input?.getBoundingClientRect().width ?? 200)} maxHeight={280} onClose={close}>
    <div class="combobox-options" bind:this={list} id={listId} role="listbox" aria-label={label}>
      {#each filtered as option, index (option.value)}
        <button id={`${uid}-option-${index}`} type="button" role="option" tabindex="-1"
          aria-selected={option.value === value} class:is-active={active === index} lang={option.lang} data-index={index}
          onpointerdown={(event) => event.preventDefault()} onclick={(event) => { event.stopPropagation(); choose(index); }}>
          <span>{option.label}</span><span class="combobox-code">{option.value}</span>
        </button>
      {/each}
    </div>
  </FloatingMenu>
{/if}

<style>
  .combobox-field { position: relative; width: 100%; min-width: 0; }
  .custom-combobox { padding-right: 32px; }
  .combobox-caret { position: absolute; inset-inline-end: 10px; top: 50%; display: flex; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
  .combobox-options { padding: 4px; overflow-y: auto; overscroll-behavior: contain; }
  .combobox-options button { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: var(--control-h); padding: 6px 8px; border-radius: 6px; color: var(--text-2); font-size: 13px; line-height: 1.4; text-align: start; overflow-wrap: anywhere; }
  .combobox-options button.is-active { background: var(--raised); color: var(--text); outline: 2px solid var(--primary); outline-offset: -2px; }
  .combobox-options button[aria-selected="true"] { color: var(--text); }
  .combobox-code { flex: none; color: var(--muted); font-size: 12px; }
  @media (hover: hover) { .combobox-options button:hover { background: var(--raised); color: var(--text); } }
  @media (forced-colors: active) { .combobox-options button[aria-selected="true"] { border: 1px solid Highlight; } }
</style>
