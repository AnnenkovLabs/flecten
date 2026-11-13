<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { formatModelName } from "../lib/model-name";
  import type { ProviderSettings } from "../lib/types";

  interface Props {
    provider: ProviderSettings;
    onadded: (modelId: string) => void;
    onclose: () => void;
  }

  let { provider, onadded, onclose }: Props = $props();

  let modelDraft = $state("");
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    input?.focus();
  });

  const draftError = $derived.by(() => {
    const modelId = modelDraft.trim();
    if (!modelId) return "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(modelId)) {
      return t("ID: Latin letters, numbers, periods, hyphens, slashes, colons, or underscores.");
    }
    if (provider.models[modelId]) return t("A model with this ID already exists.");
    return "";
  });

  function addModel(): void {
    const modelId = modelDraft.trim();
    if (!modelId || draftError) return;
    provider.models[modelId] = {
      name: formatModelName(modelId),
      context: 128_000,
      output: 8192,
      tools: true,
      reasoning: true,
      reasoningMode: "effort",
      reasoningLevels: ["low", "medium", "high"],
      source: "manual",
    };
    onadded(modelId);
  }
</script>

<div class="add-form">
  <input
    class="st-input"
    bind:this={input}
    bind:value={modelDraft}
    placeholder={t("Model ID, e.g. deepseek-chat")}
    spellcheck="false"
    aria-invalid={draftError ? "true" : undefined}
    onkeydown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onclose();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        addModel();
      }
    }}
  />
  {#if draftError}
    <span class="st-error" role="alert">{draftError}</span>
  {/if}
  <div class="add-actions">
    <button
      class="st-btn st-btn--quiet st-btn--sm"
      type="button"
      disabled={modelDraft.trim().length === 0 || Boolean(draftError)}
      onclick={addModel}
    > {t("Add model")} </button>
    <button class="st-btn st-btn--quiet st-btn--sm" type="button" onclick={onclose}>{t("Cancel")}</button>
  </div>
</div>

<style>
  .add-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 8px;
    background: rgba(240, 239, 237, 0.03);
  }

  .add-actions {
    display: flex;
    gap: 8px;
  }
</style>
