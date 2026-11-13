<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { settings } from "../lib/settings.svelte";
  import { PROTOCOLS } from "../lib/settings-utils";
  import type { ModelInfo, ProviderProtocol } from "../lib/types";
  import Icon from "./Icon.svelte";

  interface Props {
    providerId: string;
    modelId: string;
  }

  let { providerId, modelId }: Props = $props();

  const model = $derived(settings.settings?.providers[providerId]?.models[modelId]);

  let headersText = $state("{}");
  let bodyText = $state("{}");
  let variantsText = $state("{}");
  let compatText = $state("{}");
  let headersError = $state("");
  let bodyError = $state("");
  let variantsError = $state("");
  let compatError = $state("");
  let costInput = $state("");
  let costOutput = $state("");
  let costRead = $state("");
  let costWrite = $state("");
  let inputModalities = $state("");
  let outputModalities = $state("");
  let loaded = "";

  $effect(() => {
    if (!model) return;
    const key = `${providerId}:${modelId}`;
    if (loaded === key) return;
    loaded = key;
    headersText = JSON.stringify(model.headers ?? {}, null, 2);
    bodyText = JSON.stringify(model.extraBody ?? {}, null, 2);
    variantsText = JSON.stringify(model.variants ?? {}, null, 2);
    compatText = JSON.stringify(model.compat ?? {}, null, 2);
    costInput = model.cost?.input === undefined ? "" : String(model.cost.input);
    costOutput = model.cost?.output === undefined ? "" : String(model.cost.output);
    costRead = model.cost?.cacheRead === undefined ? "" : String(model.cost.cacheRead);
    costWrite = model.cost?.cacheWrite === undefined ? "" : String(model.cost.cacheWrite);
    inputModalities = (model.modalities?.input ?? []).join(", ");
    outputModalities = (model.modalities?.output ?? []).join(", ");
  });

  function parseObject(text: string): Record<string, unknown> | undefined {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  }

  function applyHeaders(): void {
    if (!model) return;
    try {
      const value = parseObject(headersText);
      if (!value) throw new Error(t("A JSON object is required"));
      const headers: Record<string, string> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry !== "string") throw new Error(t("{0}: a string value is required", [key]));
        headers[key] = entry;
      }
      if (Object.keys(headers).length > 0) model.headers = headers;
      else delete model.headers;
      headersError = "";
    } catch (error) {
      headersError = error instanceof Error ? error.message : t("Invalid JSON");
    }
  }

  function applyBody(): void {
    if (!model) return;
    try {
      const value = parseObject(bodyText);
      if (!value) throw new Error(t("A JSON object is required"));
      if (Object.keys(value).length > 0) model.extraBody = value;
      else delete model.extraBody;
      bodyError = "";
    } catch (error) {
      bodyError = error instanceof Error ? error.message : t("Invalid JSON");
    }
  }

  function applyVariants(): void {
    if (!model) return;
    try {
      const value = parseObject(variantsText);
      if (!value) throw new Error(t("A JSON object is required"));
      if (Object.keys(value).length > 0) model.variants = value as NonNullable<ModelInfo["variants"]>;
      else delete model.variants;
      variantsError = "";
    } catch (error) {
      variantsError = error instanceof Error ? error.message : t("Invalid JSON");
    }
  }

  function applyCompat(): void {
    if (!model) return;
    try {
      const value = parseObject(compatText);
      if (!value) throw new Error(t("A JSON object is required"));
      if (Object.keys(value).length > 0) model.compat = value as NonNullable<ModelInfo["compat"]>;
      else delete model.compat;
      compatError = "";
    } catch (error) {
      compatError = error instanceof Error ? error.message : t("Invalid JSON");
    }
  }

  function applyCost(): void {
    if (!model) return;
    const toNumber = (value: string): number | undefined => {
      if (value.trim() === "") return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    };
    const input = toNumber(costInput);
    const output = toNumber(costOutput);
    if (input === undefined || output === undefined) {
      if (costInput.trim() === "" && costOutput.trim() === "") {
        delete model.cost;
        return;
      }
      return;
    }
    const read = toNumber(costRead);
    const write = toNumber(costWrite);
    model.cost = {
      input,
      output,
      ...(read === undefined ? {} : { cacheRead: read }),
      ...(write === undefined ? {} : { cacheWrite: write }),
    };
  }

  function applyModalities(): void {
    if (!model) return;
    const split = (value: string): string[] =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    const input = split(inputModalities);
    const output = split(outputModalities);
    if (input.length === 0 && output.length === 0) delete model.modalities;
    else {
      model.modalities = {
        ...(input.length > 0 ? { input } : {}),
        ...(output.length > 0 ? { output } : {}),
      };
    }
  }

  function protocolValue(): string {
    return model?.protocol ?? "auto";
  }

  function setProtocol(value: string): void {
    if (!model) return;
    if (value === "auto") delete model.protocol;
    else model.protocol = value as ProviderProtocol;
  }
</script>

{#if model}
  <details class="st-details">
    <summary>
      <span class="summary-copy">
        <span class="st-title">{t("Additional fields")}</span>
        <span class="st-sub">{t("Protocol, limits, and JSON.")}</span>
      </span>
      <Icon class="st-chevron" name="chevron-down" size={16} />
    </summary>

    <div class="st-details-body">
      <div class="st-block">
        <h3 class="st-block-title">{t("Protocol and IDs")}</h3>
        <div class="st-grid">
          <label class="st-field">
            <span class="st-label">{t("Model protocol")}</span>
            <select
              class="st-select"
              value={protocolValue()}
              onchange={(event) => setProtocol(event.currentTarget.value)}
            >
              <option value="auto">{t("Same as provider")}</option>
              {#each PROTOCOLS as protocol}
                <option value={protocol.value}>{protocol.label}</option>
              {/each}
            </select>
          </label>
          <label class="st-field">
            <span class="st-label">{t("API model ID")}</span>
            <input
              class="st-input"
              bind:value={model.apiId}
              placeholder={t("defaults to the model key")}
              spellcheck="false"
            />
          </label>
          <label class="st-field">
            <span class="st-label">{t("Catalog ID")}</span>
            <input
              class="st-input"
              bind:value={model.canonicalId}
              placeholder={t("optional")}
              spellcheck="false"
            />
          </label>
          <label class="st-field">
            <span class="st-label">{t("Knowledge cutoff")}</span>
            <input class="st-input" bind:value={model.knowledge} placeholder="2024-09-30" spellcheck="false" />
            <span class="st-hint">{t("The date up to which the model has knowledge.")}</span>
          </label>
          <label class="st-field">
            <span class="st-label">{t("Release date")}</span>
            <input class="st-input" bind:value={model.releaseDate} placeholder="2025-11-13" spellcheck="false" />
          </label>
        </div>
      </div>

      <div class="st-block">
        <h3 class="st-block-title">{t("Limits")}</h3>
        <div class="st-grid">
          <label class="st-field">
            <span class="st-label">{t("Max input (tokens)")}</span>
            <input class="st-input" type="number" min="1" bind:value={model.input} placeholder={t("not set")} />
          </label>
          <label class="st-field">
            <span class="st-label">{t("Response limit field")}</span>
            <select class="st-select" bind:value={model.maxTokensParameter}>
              <option value="auto">{t("Auto")}</option>
              <option value="max_tokens">max_tokens</option>
              <option value="max_completion_tokens">max_completion_tokens</option>
            </select>
            <span class="st-hint">{t("The API parameter that limits response length.")}</span>
          </label>
        </div>
      </div>

      <div class="st-block">
        <h3 class="st-block-title">{t("Modalities and files")}</h3>
        <div class="st-grid">
          <label class="st-field">
            <span class="st-label">{t("Input")}</span>
            <input
              class="st-input"
              bind:value={inputModalities}
              onblur={applyModalities}
              placeholder="text, image, pdf"
            />
          </label>
          <label class="st-field">
            <span class="st-label">{t("Output")}</span>
            <input
              class="st-input"
              bind:value={outputModalities}
              onblur={applyModalities}
              placeholder="text"
            />
          </label>
        </div>
        <label class="st-switch">
          <span class="st-switch-copy">
            <strong>{t("Open weights")}</strong>
            <span>{t("The model's weights are open.")}</span>
          </span>
          <input type="checkbox" bind:checked={model.openWeights} />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
        <label class="st-switch">
          <span class="st-switch-copy">
            <strong>{t("Files and attachments")}</strong>
            <span>{t("The model accepts attachments.")}</span>
          </span>
          <input type="checkbox" bind:checked={model.attachment} />
          <span class="st-switch-track" aria-hidden="true"></span>
        </label>
      </div>

      <div class="st-block">
        <h3 class="st-block-title">{t("Price per 1M tokens")}</h3>
        <div class="st-grid">
          <label class="st-field">
            <span class="st-label">{t("Input")}</span>
            <input class="st-input" type="number" min="0" step="0.001" bind:value={costInput} onblur={applyCost} />
          </label>
          <label class="st-field">
            <span class="st-label">{t("Output")}</span>
            <input class="st-input" type="number" min="0" step="0.001" bind:value={costOutput} onblur={applyCost} />
          </label>
          <label class="st-field">
            <span class="st-label">{t("Cache read")}</span>
            <input class="st-input" type="number" min="0" step="0.001" bind:value={costRead} onblur={applyCost} />
          </label>
          <label class="st-field">
            <span class="st-label">{t("Cache write")}</span>
            <input class="st-input" type="number" min="0" step="0.001" bind:value={costWrite} onblur={applyCost} />
          </label>
        </div>
      </div>

      <div class="st-block">
        <div>
          <h3 class="st-block-title">{t("JSON overrides")}</h3>
          <p class="st-hint">{t("For custom servers. An object with key-value pairs.")}</p>
        </div>
        <label class="st-field">
          <span class="st-label">{t("Model headers")}</span>
          <textarea class="st-textarea" bind:value={headersText} onblur={applyHeaders} spellcheck="false" rows="3"></textarea>
          {#if headersError}<span class="st-error">{headersError}</span>{/if}
        </label>
        <label class="st-field">
          <span class="st-label">{t("Extra request body")}</span>
          <textarea class="st-textarea" bind:value={bodyText} onblur={applyBody} spellcheck="false" rows="4"></textarea>
          {#if bodyError}<span class="st-error">{bodyError}</span>{/if}
        </label>
        <label class="st-field">
          <span class="st-label">{t("Variants (JSON)")}</span>
          <textarea class="st-textarea" bind:value={variantsText} onblur={applyVariants} spellcheck="false" rows="5"></textarea>
          <span class="st-hint">{t("Named variants: reasoning, body, headers.")}</span>
          {#if variantsError}<span class="st-error">{variantsError}</span>{/if}
        </label>
        <label class="st-field">
          <span class="st-label">{t("Compatibility (JSON)")}</span>
          <textarea class="st-textarea" bind:value={compatText} onblur={applyCompat} spellcheck="false" rows="4"></textarea>
          <span class="st-hint">{t("Replay, reasoning, cache, strict tools.")}</span>
          {#if compatError}<span class="st-error">{compatError}</span>{/if}
        </label>
      </div>
    </div>
  </details>
{/if}

<style>
  .summary-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  @media (max-width: 640px) {
    .st-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
