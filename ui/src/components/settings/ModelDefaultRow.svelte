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
  <div class="model-default-controls">
    <ModelPicker {providers} provider={choice?.provider ?? ""} model={choice?.model ?? ""}
      placeholder={inherit ?? t("Select a model")} ariaLabel={title} {disabled}
      onSelect={(provider, model) => onChange({ provider, model })} />
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
    {#if choice && inherit}
      <button class="st-btn st-btn--quiet" type="button" {disabled} onclick={() => onChange(undefined)}>{inherit}</button>
    {/if}
  </div>
  {#if fixedReasoning}<span class="model-default-hint">{t("Reasoning is set by the model variant.")}</span>{/if}
  {#if !choice && fallback && hasReasoning}
    <span class="model-default-hint">{t("Changing reasoning selects the inherited model for this role.")}</span>
  {/if}
</SettingsRow>

<style>
  .model-default-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; min-width: 0; }
  .model-default-field { display: grid; gap: 4px; min-width: 0; }
  .model-default-label, .model-default-hint { color: var(--muted); font-size: 12px; }
  .model-default-hint { display: block; margin-top: 8px; }
  .model-default-controls :global(.model-trigger) { max-width: 100%; }
  .model-default-controls :global(.st-input) { width: auto; max-width: 100%; }
</style>
