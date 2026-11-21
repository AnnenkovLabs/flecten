<script lang="ts">
  import Select from "../controls/Select.svelte";
  import type { ModelChoice } from "../../../../shared/model-choice";
  import { t } from "../../lib/i18n.svelte";
  import { REASONING_LABELS } from "../../lib/settings-utils";
  import type { ProviderInfo, ReasoningEffort } from "../../lib/types";
  import ModelPicker from "../ModelPicker.svelte";
  import SettingsRow from "./SettingsRow.svelte";

  interface Props {
    title: string;
    description?: string;
    providers: ProviderInfo[];
    choice: ModelChoice | undefined;
    fallback?: ModelChoice | undefined;
    reasoningDefault?: "model" | "none";
    inherit?: string;
    disabled?: boolean;
    onChange: (choice: ModelChoice | undefined) => void;
  }
  let { title, description = "", providers, choice, fallback, reasoningDefault = "model", inherit, disabled = false, onChange }: Props = $props();
  const effective = $derived(choice ?? fallback);
  const model = $derived(providers.find((provider) => provider.id === effective?.provider)?.models[effective?.model ?? ""]);
  const hasReasoning = $derived(!!model && model.reasoning !== false && model.reasoningMode !== "none");
  const toggle = $derived(model?.reasoningMode === "toggle");
  const levels = $derived<ReasoningEffort[]>(toggle ? ["none", "medium"] : model?.reasoningLevels?.length ? model.reasoningLevels : ["low", "medium", "high"]);
  const variants = $derived(Object.entries(model?.variants ?? {}));
  const fixedReasoning = $derived(model?.variants?.[effective?.variant ?? ""]?.reasoning);

  function setReasoning(value: string): void {
    if (!effective) return;
    const next = { ...effective };
    if (value) next.reasoning = value as ReasoningEffort;
    else delete next.reasoning;
    onChange(next);
  }

  function setVariant(value: string): void {
    if (!choice) return;
    const next = { ...choice };
    if (value) next.variant = value;
    else delete next.variant;
    onChange(next);
  }
</script>

<SettingsRow {title} {description} stacked>
  <div class="model-default-stack">
    <div class="model-default-controls">
      <div class="model-default-field model-default-field--model">
        <span class="model-default-label">{t("Model")}</span>
        <div class="model-default-picker">
          <ModelPicker {providers} provider={choice?.provider ?? ""} model={choice?.model ?? ""}
            placeholder={inherit ?? t("Select a model")} ariaLabel={title} {disabled}
            onSelect={(provider, model) => onChange({ provider, model })} />
          {#if choice && inherit}
            <button class="st-btn st-btn--quiet model-default-reset" type="button" {disabled} onclick={() => onChange(undefined)}>{inherit}</button>
          {/if}
        </div>
      </div>
      <div class="model-default-field">
        <span class="model-default-label">{t("Reasoning level")}</span>
        <Select class="st-input" aria-label={`${title}: ${t("Model reasoning level")}`} disabled={disabled || !hasReasoning || !!fixedReasoning}
          value={hasReasoning ? fixedReasoning ?? effective?.reasoning ?? "" : ""} onchange={setReasoning}
          options={hasReasoning ? [
            { value: "", label: reasoningDefault === "none" ? t("Default: no reasoning") : t("Model default") },
            ...(fixedReasoning && !levels.includes(fixedReasoning) ? [{ value: fixedReasoning, label: REASONING_LABELS[fixedReasoning] ?? fixedReasoning }] : []),
            ...levels.map((level) => ({ value: level, label: toggle ? (level === "none" ? t("Off") : t("Enabled")) : REASONING_LABELS[level] ?? level })),
          ] : [{ value: "", label: model ? t("Reasoning is not supported") : t("Select a model first") }]} />
      </div>
      {#if choice && variants.length}
        <div class="model-default-field">
          <span class="model-default-label">{t("Model variant")}</span>
          <Select class="st-input" aria-label={`${title}: ${t("Model variant")}`} {disabled}
            value={choice.variant ?? ""} onchange={setVariant}
            options={[{ value: "", label: t("Default variant") }, ...variants.map(([id, variant]) => ({ value: id, label: variant.name ?? id }))]} />
        </div>
      {/if}
    </div>
    {#if fixedReasoning}
      <p class="model-default-hint">{t("Reasoning is set by the model variant.")}</p>
    {/if}
    {#if !choice && fallback && hasReasoning}
      <p class="model-default-hint">{t("Changing reasoning selects the inherited model for this role.")}</p>
    {/if}
  </div>
</SettingsRow>

<style>
  .model-default-stack {
    display: grid;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }
  .model-default-controls {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    align-items: start;
    gap: 12px;
    width: 100%;
    min-width: 0;
    margin-top: 2px;
  }
  .model-default-field {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .model-default-picker {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .model-default-label {
    color: var(--muted);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
  }
  .model-default-hint {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
    text-wrap: pretty;
  }
  .model-default-controls :global(.model-picker) {
    flex: 1;
    min-width: 0;
  }
  .model-default-controls :global(.model-picker .model-button) {
    justify-content: space-between;
    width: 100%;
    max-width: 100%;
    height: var(--control-h);
    padding: 0 11px;
    border-radius: 8px;
    background: #141414;
    color: var(--text);
    font-size: 13px;
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .model-default-controls :global(.model-picker .model-button:hover:not(:disabled)) {
    background: var(--raised);
  }
  .model-default-controls :global(.model-picker .model-button:disabled) {
    opacity: 0.42;
    cursor: default;
  }
  .model-default-controls :global(.st-input) {
    width: 100%;
    max-width: 100%;
    height: var(--control-h);
    min-height: var(--control-h);
  }
  .model-default-reset {
    height: var(--control-h);
    border-radius: 8px;
    box-shadow: inset 0 0 0 1px var(--line);
  }
</style>
