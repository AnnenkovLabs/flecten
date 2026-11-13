<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    provider: { headers?: Record<string, string> | undefined };
    providerId: string;
  }

  let { provider, providerId }: Props = $props();

  let headerRows = $state<Array<{ key: string; value: string }>>([]);
  let loadedHeaders = "";

  const headerError = $derived(
    headerRows.some((row) => row.key.trim().length === 0 && row.value.trim().length > 0)
      ? t("Enter a header name or clear the value.")
      : "",
  );

  $effect(() => {
    if (loadedHeaders === providerId) return;
    loadedHeaders = providerId;
    headerRows = Object.entries(provider.headers ?? {}).map(([key, value]) => ({ key, value }));
  });

  function syncHeaders(): void {
    const headers: Record<string, string> = {};
    for (const row of headerRows) {
      const key = row.key.trim();
      if (key) headers[key] = row.value;
    }
    provider.headers = headers;
  }

  function addHeader(): void {
    headerRows = [...headerRows, { key: "", value: "" }];
  }

  function removeHeader(index: number): void {
    headerRows = headerRows.filter((_, rowIndex) => rowIndex !== index);
    syncHeaders();
  }
</script>

<div class="st-field headers-field">
  <span class="st-label">{t("API headers")}</span>
  {#each headerRows as row, index (index)}
    <div class="header-row">
      <input
        class="st-input"
        bind:value={row.key}
        placeholder="X-Custom-Header"
        aria-label={t("Header name")}
        spellcheck="false"
        data-settings-field={t("API headers")}
        oninput={syncHeaders}
      />
      <input
        class="st-input"
        bind:value={row.value}
        placeholder={t("value")}
        aria-label={t("Header value")}
        spellcheck="false"
        oninput={syncHeaders}
      />
      <button
        class="st-btn st-btn--quiet st-btn--sm"
        type="button"
        aria-label={t("Delete header")}
        onclick={() => removeHeader(index)}
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  {/each}
  {#if headerError}
    <span class="st-error" role="alert">{headerError}</span>
  {/if}
  <button class="st-btn st-btn--quiet st-btn--sm add-header" type="button" onclick={addHeader}>
    <Icon name="plus" size={13} /> {t("Add header")} </button>
</div>

<style>
  .headers-field {
    gap: 8px;
  }

  .header-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) 34px;
    gap: 8px;
    align-items: center;
  }

  .add-header {
    align-self: flex-start;
  }

  @media (max-width: 900px) {
    .header-row {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 40px;
    }
  }
</style>
