<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { interfaceScale, INTERFACE_SCALE, setInterfaceScale } from "../../lib/interface-scale.svelte";
  import Icon from "../Icon.svelte";

  const id = $props.id();
</script>

<div class="st-row scale-row">
  <div class="st-row-copy">
    <label for={id} class="st-row-title">{t("Interface Scale")}</label>
    <p id={`${id}-description`} class="st-row-desc">{t("Resize text, controls, and the chat column. Changes apply immediately.")}</p>
  </div>
  <div class="scale-control">
    <input id={id} type="range" min={INTERFACE_SCALE.min} max={INTERFACE_SCALE.max}
      style:--range-fill={`${(interfaceScale.percent - INTERFACE_SCALE.min) / (INTERFACE_SCALE.max - INTERFACE_SCALE.min) * 100}%`}
      step={INTERFACE_SCALE.step} value={interfaceScale.percent}
      aria-describedby={`${id}-description`} aria-valuetext={`${interfaceScale.percent}%`}
      oninput={(event) => setInterfaceScale(event.currentTarget.valueAsNumber)} />
    <output for={id}>{interfaceScale.percent}%</output>
    <button class="st-btn st-btn--quiet" type="button" aria-label={t("Reset to 100%")}
      data-tooltip={t("Reset to 100%")}
      disabled={interfaceScale.percent === INTERFACE_SCALE.default}
      onclick={() => setInterfaceScale(INTERFACE_SCALE.default)}>
      <Icon name="refresh" size={15} />
    </button>
  </div>
</div>

<style>
  .scale-row { flex-wrap: wrap; }
  .st-row-copy { flex-basis: 220px; }
  .scale-control { display: flex; align-items: center; gap: var(--space-2); flex: 1 1 240px; max-width: 280px; }
  input { min-width: 80px; width: 100%; height: var(--control-h); margin: 0; cursor: pointer; }
  output { min-width: 4ch; color: var(--text-2); font-size: 12px; font-variant-numeric: tabular-nums; text-align: end; }
  button { flex: none; width: var(--control-h); padding: 0; }
</style>
