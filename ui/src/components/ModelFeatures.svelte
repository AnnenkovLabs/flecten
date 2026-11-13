<script lang="ts">
  import { i18n, t } from "../lib/i18n.svelte";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    providerId: string;
    modelId: string;
  }

  type FlagKey =
    | "tools"
    | "vision"
    | "temperature"
    | "structuredOutput"
    | "audio"
    | "pdf"
    | "computerUse"
    | "promptCache"
    | "parallelToolCalls"
    | "interleavedReasoning"
    | "disabled";

  const FLAGS: Array<{ key: FlagKey; label: string; hint: string }> = $derived([
    {
      key: "tools",
      label: t("Tools"),
      hint: t("The model calls read, write, bash, and other tools."),
    },
    { key: "vision", label: t("Images"), hint: t("Understands images in the input.") },
    { key: "temperature", label: t("Temperature"), hint: t("Accepts the temperature parameter.") },
    {
      key: "structuredOutput",
      label: t("Structured output"),
      hint: t("Responds using the specified JSON schema."),
    },
    { key: "audio", label: t("Audio"), hint: t("WAV and MP3 via Chat Completions, audio files via Gemini.") },
    { key: "pdf", label: "PDF", hint: "" },
    { key: "computerUse", label: t("Computer use"), hint: "" },
    {
      key: "promptCache",
      label: t("Prompt cache"),
      hint: t("The provider caches the shared request prefix."),
    },
    {
      key: "parallelToolCalls",
      label: t("Parallel calls"),
      hint: t("Multiple tools in one turn."),
    },
    {
      key: "interleavedReasoning",
      label: t("Reasoning between calls"),
      hint: t("The model reasons after receiving a tool result."),
    },
    {
      key: "disabled",
      label: t("Hide from selection"),
      hint: "",
    },
  ]);

  let { providerId, modelId }: Props = $props();

  const model = $derived(settings.settings?.providers[providerId]?.models[modelId]);
  const probe = $derived(settings.probeResults[settings.probeKey(providerId, modelId)]);
  const verified = $derived(model?.verified);

  function flagValue(key: FlagKey): boolean {
    const value = model?.[key];
    if (value !== undefined) return value === true;
    const modality = key === "vision" ? "image" : key === "audio" ? "audio" : key === "pdf" ? "pdf" : null;
    return modality !== null && model?.modalities?.input?.includes(modality) === true;
  }

  function setFlag(key: FlagKey, value: boolean): void {
    if (model) model[key] = value;
  }
</script>

{#if model}
  <section class="sheet-section">
    <h3 class="st-title">{t("Capabilities")}</h3>
    <div class="flag-list">
      {#each FLAGS as flag (flag.key)}
        <label class="st-switch">
          <span class="st-switch-copy">
            <strong>{flag.label}</strong>
            {#if flag.hint}<span>{flag.hint}</span>{/if}
          </span>
          <input
            type="checkbox"
            checked={flagValue(flag.key)}
            onchange={(event) => setFlag(flag.key, event.currentTarget.checked)}
          />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
      {/each}
    </div>
  </section>

  <section class="sheet-section">
    <h3 class="st-title">{t("Model test")}</h3>
    {#if verified?.at}<p class="st-hint">{t("Tested: {0}", [new Date(verified.at).toLocaleString(i18n.locale)])}</p>{/if}
    <div class="verify-row">
      <div class="verify-badges">
        {#if verified?.text}<span class="st-badge st-badge--ok">{t("text")}</span>{/if}
        {#if verified?.tools}<span class="st-badge st-badge--ok">{t("tools")}</span>{/if}
        {#if verified?.reasoning}<span class="st-badge st-badge--ok">{t("reasoning")}</span>{/if}
        {#if !verified?.text && !verified?.tools && !verified?.reasoning}
          <span class="st-badge">{t("not tested")}</span>
        {/if}
      </div>
      <button
        class="st-btn st-btn--quiet st-btn--sm"
        type="button"
        disabled={probe === "loading"}
        onclick={() => settings.probe(providerId, modelId)}
      >
        <Icon name="refresh" size={13} />
        {probe === "loading" ? t("Testing…") : t("Run model test")}
      </button>
    </div>
    {#if probe && probe !== "loading"}
      <div
        class="st-status"
        class:st-status--ok={probe.text}
        class:st-status--error={!probe.text}
        role="status"
      >
        <Icon name={probe.text ? "check" : "x"} size={14} />
        <span> {t("Text {0}, tools {1}, reasoning {2}.", [probe.text ? t("available") : t("none"), probe.tools ? t("available") : t("none"), probe.reasoning ? t("visible") : t("not visible")])} {#if probe.error}{probe.error}{/if}
        </span>
        <span class="st-status-meta">{t("{0} ms", [probe.latencyMs])}</span>
      </div>
    {/if}
  </section>
{/if}

<style>
  .sheet-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .flag-list {
    display: flex;
    flex-direction: column;
  }

  .verify-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .verify-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
</style>
