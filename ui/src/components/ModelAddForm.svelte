<script lang="ts">
  import { onDestroy } from "svelte";
  import { t } from "../lib/i18n.svelte";
  import { settings } from "../lib/settings.svelte";
  import { clone } from "../lib/settings-utils";
  import { fetchModelMetadata } from "../lib/settings/model-metadata";
  import type { ProviderSettings } from "../lib/types";

  interface Props {
    providerId: string;
    provider: ProviderSettings;
    onadded: (modelId: string) => void;
    onclose: () => void;
  }

  let { providerId, provider, onadded, onclose }: Props = $props();

  let modelDraft = $state("");
  let input = $state<HTMLInputElement | null>(null);
  let adding = $state(false);
  let error = $state("");
  let mounted = true;
  onDestroy(() => { mounted = false; });

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

  async function addModel(): Promise<void> {
    const modelId = modelDraft.trim();
    if (!modelId || draftError || adding) return;
    const target = provider;
    adding = true;
    error = "";
    try {
      const result = await fetchModelMetadata(settings, providerId, modelId);
      if (!mounted || provider !== target || target.models[modelId]) return;
      target.models[modelId] = result.model;
      target.modelMetadataBaseline = {
        ...target.modelMetadataBaseline,
        [modelId]: clone(result.model),
      };
      onadded(modelId);
    } catch (cause) {
      if (mounted) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      adding = false;
    }
  }
</script>

<div class="add-form">
  <input
    class="st-input"
    bind:this={input}
    bind:value={modelDraft}
    placeholder={t("Model ID, e.g. deepseek-chat")}
    spellcheck="false"
    disabled={adding}
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
  {#if error}<span class="st-error" role="alert">{error}</span>{/if}
  <div class="add-actions">
    <button
      class="st-btn st-btn--quiet st-btn--sm"
      type="button"
      disabled={adding || modelDraft.trim().length === 0 || Boolean(draftError)}
      onclick={addModel}
    > {adding ? t("Updating…") : t("Add model")} </button>
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
