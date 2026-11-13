<script lang="ts">
  import { i18n, t } from "../lib/i18n.svelte";
  import { modelsCount } from "../lib/format";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";

  const status = $derived(settings.catalogStatus);
  const updated = $derived(
    status?.updatedAt
      ? new Date(status.updatedAt).toLocaleString(i18n.locale, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
  );

  const label = $derived.by(() => {
    if (settings.syncing) return t("Updating…");
    if (!status) return t("Update");
    if (status.stale) return t("Outdated · update");
    return modelsCount(status.models);
  });

  const tooltip = $derived.by(() => {
    if (!status) return t("Update model catalog");
    return t("Updated {0}. Fallback: {1}. Click to update.", [updated, modelsCount(status.fallbackModels)]);
  });
</script>

<button
  class="catalog"
  class:is-stale={status?.stale}
  type="button"
  disabled={settings.syncing}
  aria-label={t("Update model catalog")}
  title={tooltip}
  onclick={() => settings.syncCatalog()}
>
  <Icon name="refresh" size={12} />
  <span>{label}</span>
</button>

<style>
  .catalog {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 4px;
    color: var(--muted);
    font-size: 12px;
    text-align: left;
    transition: color var(--t-touch) var(--ease);
  }

  .catalog :global(.icon) {
    transition: transform 520ms var(--ease-jelly);
  }

  .catalog:hover :global(.icon) {
    transform: rotate(50deg);
  }

  .catalog:disabled :global(.icon) {
    animation: catalog-spin 1.4s linear infinite;
  }

  @keyframes catalog-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .catalog::before {
    content: "";
    position: absolute;
    inset: -2px;
  }

@media (hover: hover) and (pointer: fine) {
  .catalog:hover {
    color: var(--text-2);
  }
}
  .catalog.is-stale {
    color: var(--warning);
  }

  .catalog:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
