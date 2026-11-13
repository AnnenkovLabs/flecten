<script lang="ts">
  import { i18n, t } from "../lib/i18n.svelte";
  import { formatNumber, formatTokens } from "../lib/format";
  import { formatModelName } from "../lib/model-name";
  import type { ModelInfo } from "../lib/types";
  import Icon from "./Icon.svelte";
  import SelectBox from "./SelectBox.svelte";

  interface Props {
    modelId: string;
    model: ModelInfo;
    current: boolean;
    selected: boolean;
    onselect: (checked: boolean) => void;
    onedit: () => void;
    onkeydown: (event: KeyboardEvent) => void;
  }

  let { modelId, model, current, selected, onselect, onedit, onkeydown }: Props = $props();

  const name = $derived(model.name || formatModelName(modelId));
  const badges = $derived.by(() => {
    const result: Array<{ label: string; title: string }> = [];
    if (model.context) {
      result.push({
        label: formatTokens(model.context),
        title: t("Context: {0} tokens", [formatNumber(model.context)]),
      });
    }
    if (model.disabled) result.push({ label: t("Hidden model"), title: t("Not shown in the model picker") });
    if (model.tools) result.push({ label: t("Tools"), title: t("Tool calling") });
    if (model.reasoning) result.push({ label: t("Reasoning"), title: t("Reasoning") });
    if (model.vision) result.push({ label: t("Vision"), title: t("Image input") });
    if (model.pdf) result.push({ label: "PDF", title: t("PDF input") });
    if (model.audio) result.push({ label: t("Audio"), title: t("Audio input") });
    if (model.verified?.at) result.push({ label: t("Verified"), title: t("Tested: {0}", [new Date(model.verified.at).toLocaleString(i18n.locale)]) });
    return result;
  });
</script>

<div class="model-row" class:is-current={current} class:is-selected={selected}>
  <SelectBox
    checked={selected}
    variant="row"
    label={t("Select model {0}", [model.name || modelId])}
    onchange={onselect}
  />
  <button
    class="model-main"
    type="button"
    data-model-id={modelId}
    aria-current={current ? "true" : undefined}
    aria-label={t("Configure model {0}", [model.name || modelId])}
    onclick={onedit}
    {onkeydown}
  >
    <span class="model-copy">
      <span class="model-title">
        <span class="model-name" title={`${name} · ${modelId}`}>{name}</span>
      </span>
      <span class="model-badges">
        {#each badges as badge (badge.label)}
          <span class="st-badge" title={badge.title}>{badge.label}</span>
        {/each}
      </span>
      {#if current}
        <span class="current" title={t("Current model")}><Icon name="check" size={12} /></span>
      {/if}
    </span>
    <span class="row-chevron"><Icon name="chevron-right" size={15} /></span>
  </button>
</div>

<style>
  .model-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding: 0 4px 0 2px;
    border-radius: 8px;
    transition: background var(--t-touch) var(--ease);
  }

  @media (hover: hover) and (pointer: fine) {
    .model-row:hover {
      background: rgba(240, 239, 237, 0.04);
    }
  }

  .model-row.is-current {
    background: rgba(240, 239, 237, 0.055);
  }

  .model-row.is-selected {
    background: color-mix(in srgb, var(--primary) 8%, transparent);
  }

  .model-row:hover :global(.select.is-row),
  .model-row:focus-within :global(.select.is-row),
  .model-row.is-selected :global(.select.is-row) {
    opacity: 1;
  }

  .model-main {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    min-height: 40px;
    padding: 4px;
    border-radius: 7px;
    text-align: left;
  }

  .model-main:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .model-copy {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
    flex-wrap: wrap;
  }

  .model-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .model-name {
    overflow: hidden;
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .current {
    display: grid;
    place-items: center;
    flex: none;
    color: var(--primary);
  }

  .model-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .st-badge {
    height: 19px;
    padding: 0 6px;
    font-size: 12px;
  }

  .row-chevron {
    flex: none;
    color: var(--muted);
    opacity: 0.6;
    transition:
      opacity var(--t-touch) var(--ease),
      transform var(--t-touch) var(--ease);
  }

  @media (hover: hover) and (pointer: fine) {
    .model-row:hover .row-chevron {
      opacity: 1;
      transform: translateX(1px);
    }
  }
</style>
