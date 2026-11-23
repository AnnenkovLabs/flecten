<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import Icon from "../Icon.svelte";

  interface Props {
    title: string;
    description?: string;
    value: number;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    unit: "%" | "px";
    onchange: (value: number) => void;
  }

  let { title, description = "", value, min, max, step, defaultValue, unit, onchange }: Props =
    $props();

  const id = $props.id();
  const format = (amount: number): string => (unit === "%" ? `${amount}%` : `${amount} px`);
  const fill = $derived(`${((value - min) / (max - min)) * 100}%`);
  const display = $derived(format(value));
  const defaultDisplay = $derived(format(defaultValue));
</script>

<div class="st-row scale-row">
  <div class="st-row-copy">
    <label for={id} class="st-row-title">{title}</label>
    {#if description}
      <p id={`${id}-description`} class="st-row-desc">{description}</p>
    {/if}
  </div>
  <div class="scale-control">
    <input
      {id}
      type="range"
      {min}
      {max}
      {step}
      {value}
      style:--range-fill={fill}
      aria-describedby={description ? `${id}-description` : undefined}
      aria-valuetext={display}
      oninput={(event) => onchange(event.currentTarget.valueAsNumber)}
    />
    <output for={id}>{display}</output>
    <button
      class="st-btn st-btn--quiet"
      type="button"
      aria-label={t("Reset {0} to {1}", [title, defaultDisplay])}
      data-tooltip={t("Reset to {0}", [defaultDisplay])}
      disabled={value === defaultValue}
      onclick={() => onchange(defaultValue)}
    >
      <Icon name="refresh" size={15} />
    </button>
  </div>
</div>

<style>
  .scale-row {
    flex-wrap: wrap;
  }
  .st-row-copy {
    flex: 1 1 220px;
  }
  .scale-control {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 1 280px;
    width: 280px;
    max-width: 100%;
  }
  input {
    min-width: 80px;
    width: 100%;
    height: var(--control-h);
    margin: 0;
    cursor: pointer;
  }
  output {
    min-width: 6ch;
    color: var(--text-2);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: end;
    white-space: nowrap;
  }
  button {
    flex: none;
    width: var(--control-h);
    padding: 0;
  }
</style>
