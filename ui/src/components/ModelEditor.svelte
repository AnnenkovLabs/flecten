<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { modal } from "../lib/modal";
  import { formatModelName } from "../lib/model-name";
  import { settings } from "../lib/settings.svelte";
  import { ALL_EFFORTS, REASONING_LABELS } from "../lib/settings-utils";
  import { modelIssues } from "../lib/settings/validation";
  import type { ReasoningEffort } from "../lib/types";
  import Icon from "./Icon.svelte";
  import ModelAdvanced from "./ModelAdvanced.svelte";
  import ModelFeatures from "./ModelFeatures.svelte";

  interface Props {
    providerId: string;
    modelId: string;
    onClose: () => void;
  }

  let { providerId, modelId, onClose }: Props = $props();

  const model = $derived(settings.settings?.providers[providerId]?.models[modelId]);
  const levels = $derived(model?.reasoningLevels ?? []);
  const issues = $derived(model ? modelIssues(model) : {});
  const canRemove = $derived(Object.keys(settings.settings?.providers[providerId]?.models ?? {}).length > 1);
  const active = $derived(
    settings.settings?.provider === providerId && settings.settings?.model === modelId,
  );

  let confirmDelete = $state(false);



  function toggleLevel(level: ReasoningEffort): void {
    if (!model) return;
    const current = model.reasoningLevels ?? [];
    model.reasoningLevels = current.includes(level)
      ? current.filter((entry) => entry !== level)
      : [...current, level].sort(
          (left, right) => ALL_EFFORTS.indexOf(left) - ALL_EFFORTS.indexOf(right),
        );
  }

  function remove(): void {
    settings.removeModel(providerId, modelId);
    onClose();
  }
</script>

{#if model}
  <dialog
    class="model-sheet st-dialog"
    use:modal
    aria-labelledby="model-sheet-title"
    oncancel={(event) => {
      event.preventDefault();
      onClose();
    }}
  >
    <header class="sheet-head">
      <div class="sheet-title">
        <h2 id="model-sheet-title">{model.name || formatModelName(modelId)}</h2>
        <span class="sheet-id st-mono">{modelId}</span>
      </div>
      <div class="sheet-actions">
        {#if active}
          <span class="st-badge"><Icon name="check" size={11} /> {t("current")}</span>
        {:else}
          <button
            class="st-btn st-btn--quiet st-btn--sm"
            type="button"
            onclick={() => settings.setActive(providerId, modelId)}
          >
            <Icon name="check" size={13} /> {t("Set as current")} </button>
        {/if}
        <button
          class="st-icon-btn"
          type="button"
          aria-label={t("Close model")}
          title={t("Close model")}
          onclick={onClose}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </header>

    <div class="sheet-body">
      <section class="sheet-section">
        <h3 class="st-title">{t("General")}</h3>
        <div class="st-grid">
          <label class="st-field span-2">
            <span class="st-label">{t("Name")}</span>
            <div class="inline">
              <input
                class="st-input"
                bind:value={model.name}
                placeholder={formatModelName(modelId)}
              />
              <button
                class="st-btn st-btn--quiet st-btn--sm"
                type="button"
                title={t("Generate name from ID")}
                onclick={() => settings.applyName(providerId, modelId)}
              > {t("From ID")} </button>
            </div>
          </label>
          <label class="st-field">
            <span class="st-label">{t("Context (tokens)")}</span>
            <input class="st-input" type="number" min="1" bind:value={model.context} aria-invalid={issues.context ? "true" : undefined} />
            {#if issues.context}<span class="st-error" role="alert">{issues.context}</span>{/if}
          </label>
          <label class="st-field">
            <span class="st-label">{t("Response limit (tokens)")}</span>
            <input class="st-input" type="number" min="1" bind:value={model.output} aria-invalid={issues.output ? "true" : undefined} />
            {#if issues.output}<span class="st-error" role="alert">{issues.output}</span>{/if}
          </label>
        </div>
      </section>

      <section class="sheet-section">
        <h3 class="st-title">{t("Reasoning")}</h3>
        <div class="st-grid">
          <label class="st-field">
            <span class="st-label">{t("Mode")}</span>
            <select class="st-select" bind:value={model.reasoningMode}>
              <option value="effort">{t("Effort")}</option>
              <option value="budget">{t("Token budget")}</option>
              <option value="toggle">{t("On/off")}</option>
              <option value="none">{t("None")}</option>
            </select>
          </label>
          <label class="st-field">
            <span class="st-label">{t("Budget (tokens)")}</span>
            <input class="st-input" type="number" min="1" bind:value={model.reasoningBudget} aria-invalid={issues.reasoningBudget ? "true" : undefined} />
            {#if issues.reasoningBudget}<span class="st-error" role="alert">{issues.reasoningBudget}</span>{/if}
            <span class="st-hint">{t("Used in Token budget mode.")}</span>
          </label>
          <div class="st-field span-2">
            <span class="st-label">{t("Reasoning levels")}</span>
            <div class="chips">
              {#each ALL_EFFORTS as level}
                <button
                  class="st-chip"
                  class:is-on={levels.includes(level)}
                  type="button"
                  onclick={() => toggleLevel(level)}
                >
                  {REASONING_LABELS[level]}
                </button>
              {/each}
            </div>
            <span class="st-hint">{t("Selected levels will appear in the selector next to the model.")}</span>
          </div>
        </div>
        <label class="st-switch">
          <span class="st-switch-copy">
            <strong>{t("Reasoning")}</strong>
            <span>{t("The model supports reasoning.")}</span>
          </span>
          <input
            type="checkbox"
            checked={Boolean(model.reasoning)}
            onchange={(event) => (model.reasoning = event.currentTarget.checked)}
          />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
        <label class="st-switch">
          <span class="st-switch-copy">
            <strong>{t("Reasoning toggle")}</strong>
            <span>{t("Show a reasoning toggle in the model selector.")}</span>
          </span>
          <input
            type="checkbox"
            checked={Boolean(model.reasoningToggle)}
            onchange={(event) => (model.reasoningToggle = event.currentTarget.checked)}
          />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
      </section>

      <ModelFeatures {providerId} {modelId} />

      <section class="sheet-section">
        <ModelAdvanced {providerId} {modelId} />
      </section>
    </div>

    <footer class="sheet-foot">
      {#if confirmDelete}
        <div class="delete-confirm">
          <span>{t("Delete model “{0}” from the configuration?", [model.name || modelId])}</span>
          <div class="delete-actions">
            <button
              class="st-btn st-btn--quiet st-btn--sm"
              type="button"
              onclick={() => (confirmDelete = false)}
            > {t("Cancel")} </button>
            <button class="st-btn st-btn--danger st-btn--sm" type="button" onclick={remove}> {t("Delete")} </button>
          </div>
        </div>
      {:else}
        <button
          class="st-btn st-btn--danger st-btn--sm"
          type="button"
          disabled={!canRemove}
          title={canRemove ? undefined : t("Keep at least one model for this provider")}
          onclick={() => (confirmDelete = true)}
        >
          <Icon name="trash" size={13} /> {t("Delete model")} </button>
        <div class="foot-end">
          <span class="st-hint">{t("Changes take effect after you save settings.")}</span>
          <button class="st-btn st-btn--primary" type="button" onclick={onClose}>{t("Done")}</button>
        </div>
      {/if}
    </footer>
  </dialog>
{/if}

<style>
  .model-sheet.st-dialog {
    inset: 0 0 0 auto;
    width: min(560px, 100vw);
    max-width: 100vw;
    height: 100vh;
    max-height: 100vh;
    margin: 0;
    border-radius: 0;
    box-shadow:
      -1px 0 0 rgba(240, 239, 237, 0.09),
      -24px 0 80px rgba(0, 0, 0, 0.48);
    transform: translateX(26px);
  }

  .model-sheet.st-dialog[open] {
    transform: translateX(0);
  }

  @starting-style {
    .model-sheet.st-dialog[open] {
      transform: translateX(26px);
    }
  }

  .model-sheet {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
  }

  .sheet-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--line);
  }

  .sheet-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  h2 {
    overflow: hidden;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sheet-id {
    overflow: hidden;
    color: var(--muted);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sheet-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }

  .sheet-body {
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-height: 0;
    overflow-y: auto;
    padding: 24px 24px 28px;
  }

  .sheet-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .span-2 {
    grid-column: 1 / -1;
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .inline .st-input {
    flex: 1;
    min-width: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .sheet-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 64px;
    padding: 12px 24px;
    border-top: 1px solid var(--line);
    background: var(--bg);
  }

  .foot-end {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }

  .delete-confirm {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    color: var(--text-2);
    font-size: 13px;
  }

  .delete-actions {
    display: flex;
    gap: 6px;
  }

  @media (max-height: 720px) {
    .sheet-head {
      padding: 12px 20px 12px;
    }

    .sheet-body {
      gap: 20px;
      padding: 16px 20px 24px;
    }
  }

  @media (max-width: 700px) {
    .model-sheet.st-dialog {
      width: 100vw;
    }

    .sheet-foot {
      flex-direction: column;
      align-items: stretch;
    }

    .foot-end {
      justify-content: space-between;
    }
  }
</style>
