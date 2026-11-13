<script lang="ts">
  import Icon from "./Icon.svelte";

  interface Props {
    checked: boolean;
    label: string;
    variant: "all" | "row";
    caption?: string;
    onchange: (checked: boolean) => void;
  }

  let { checked, label, variant, caption, onchange }: Props = $props();
</script>

<label class="select" class:is-all={variant === "all"} class:is-row={variant === "row"}>
  <input
    type="checkbox"
    {checked}
    aria-label={label}
    onchange={(event) => onchange(event.currentTarget.checked)}
  />
  <span class="select-box" aria-hidden="true"><Icon name="check" size={11} /></span>
  {#if caption}
    <span class="select-copy">{caption}</span>
  {/if}
</label>

<style>
  .select {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    cursor: pointer;
  }

  .select.is-all {
    width: fit-content;
    min-height: 32px;
    margin-left: auto;
  }

  .select.is-row {
    justify-content: center;
    width: 34px;
    flex: none;
    opacity: 0;
    transition: opacity 160ms var(--ease);
  }

  @media (hover: none) {
    .select.is-row {
      opacity: 1;
    }
  }

  input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .select-box {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: none;
    border-radius: 5px;
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: transparent;
  }

  input:checked + .select-box {
    background: color-mix(in srgb, var(--primary) 18%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 60%, transparent);
    color: var(--primary);
  }

  input:focus-visible + .select-box {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .select-copy {
    color: var(--muted);
    font-size: 12px;
  }
</style>
