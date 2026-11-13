<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";
  import ModelAddForm from "./ModelAddForm.svelte";
  import ModelBulkBar from "./ModelBulkBar.svelte";
  import ModelEditor from "./ModelEditor.svelte";
  import ModelRow from "./ModelRow.svelte";
  import SelectBox from "./SelectBox.svelte";

  interface Props {
    providerId: string;
  }

  type ModelFilter = "all" | "enabled" | "disabled" | "tools" | "reasoning" | "vision";

  interface FilterEntry {
    id: ModelFilter;
    label: string;
  }

  const FILTERS: FilterEntry[] = $derived([
    { id: "all", label: t("All") },
    { id: "enabled", label: t("Enabled models") },
    { id: "disabled", label: t("Hidden models") },
    { id: "tools", label: t("Tools") },
    { id: "reasoning", label: t("Reasoning") },
    { id: "vision", label: t("Vision") },
  ]);

  let { providerId }: Props = $props();

  const provider = $derived(settings.settings?.providers[providerId]);
  const update = $derived(
    settings.actualizeResult?.providerId === providerId ? settings.actualizeResult : null,
  );

  let modelSearch = $state("");
  let filter = $state<ModelFilter>("all");
  let selected = $state<Record<string, boolean>>({});
  let confirmActualize = $state(false);
  let editingModel = $state<string | null>(null);
  let addOpen = $state(false);
  let lastProvider = "";

  $effect(() => {
    if (providerId === lastProvider) return;
    lastProvider = providerId;
    editingModel = null;
    modelSearch = "";
    addOpen = false;
    confirmActualize = false;
    selected = {};
    filter = "all";
  });

  $effect(() => {
    modelSearch;
    filter;
    selected = {};
  });

  const allIds = $derived(provider ? Object.keys(provider.models) : []);
  const models = $derived(
    provider
      ? Object.entries(provider.models).filter(([modelId, model]) => {
          const needle = modelSearch.trim().toLowerCase();
          if (needle) {
            const matches =
              modelId.toLowerCase().includes(needle) ||
              (model.name ?? "").toLowerCase().includes(needle);
            if (!matches) return false;
          }
          if (filter === "enabled") return model.disabled !== true;
          if (filter === "disabled") return model.disabled === true;
          if (filter === "tools") return model.tools === true;
          if (filter === "reasoning") return model.reasoning === true;
          if (filter === "vision") return model.vision === true;
          return true;
        })
      : [],
  );
  const visibleIds = $derived(models.map(([modelId]) => modelId));
  const selectedIds = $derived(
    Object.keys(selected).filter((modelId) => selected[modelId] === true),
  );
  const allVisibleSelected = $derived(
    visibleIds.length > 0 && visibleIds.every((modelId) => selected[modelId] === true),
  );
  const canDeleteSelected = $derived(
    selectedIds.length > 0 && selectedIds.length < allIds.length,
  );
  function added(modelId: string): void {
    addOpen = false;
    editingModel = modelId;
  }

  function probeLabel(value: boolean | undefined, yes: string, no: string): string {
    if (value === undefined) return t("not tested");
    return value ? yes : no;
  }

  function probeTitle(): string {
    const result = update;
    if (!result) return "";
    return t("Test {0}: text {1}, tools {2}, reasoning {3}.", [result.probedModel, probeLabel(result.probe.text, t("available"), t("none")), probeLabel(result.probe.tools, t("available"), t("none")), probeLabel(result.probe.reasoning, t("visible"), t("not visible"))]);
  }

  function onModelKeydown(event: KeyboardEvent, modelId: string): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>(".model-main"));
    const index = rows.findIndex((row) => row.dataset.modelId === modelId);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(index + 1, rows.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    event.preventDefault();
    rows[next]?.focus();
  }

  function toggleSelected(modelId: string, value: boolean): void {
    selected = { ...selected, [modelId]: value };
  }

  function toggleAll(): void {
    if (allVisibleSelected) {
      selected = {};
      return;
    }
    const next: Record<string, boolean> = {};
    for (const modelId of visibleIds) next[modelId] = true;
    selected = next;
  }

  function setEnabled(disabled: boolean): void {
    if (!provider) return;
    for (const modelId of selectedIds) {
      const model = provider.models[modelId];
      if (model) model.disabled = disabled;
    }
    selected = {};
  }

  function removeSelected(): void {
    if (!provider || !canDeleteSelected) return;
    for (const modelId of selectedIds) settings.removeModel(providerId, modelId);
    selected = {};
  }

  function isCurrent(modelId: string): boolean {
    return settings.settings?.provider === providerId && settings.settings?.model === modelId;
  }

  function clearActualize(): void {
    confirmActualize = false;
  }
</script>

{#if provider}
  <section class="models" aria-label={t("Provider models")}>
    <div class="models-tools">
      <label class="st-search">
        <Icon name="search" size={14} />
        <input
          bind:value={modelSearch}
          placeholder={t("Find a model")}
          aria-label={t("Search models")}
          data-settings-field={t("Model Models")}
        />
      </label>
      <button
        class="st-btn st-btn--quiet"
        type="button"
        onclick={() => {
          addOpen = !addOpen;
          confirmActualize = false;
        }}
      >
        <Icon name="plus" size={13} /> {t("Add")} </button>
      <button
        class="st-btn st-btn--quiet"
        type="button"
        disabled={settings.actualizing}
        onclick={() => {
          confirmActualize = true;
          addOpen = false;
        }}
      >
        <Icon name="refresh" size={13} />
        {settings.actualizing ? t("Updating…") : t("Refresh from API")}
      </button>
    </div>

    <div class="filters">
      <select class="st-select model-filter" bind:value={filter} aria-label={t("Model filter")}>
        {#each FILTERS as entry (entry.id)}
          <option value={entry.id}>{entry.label}</option>
        {/each}
      </select>
      {#if filter !== "all" || modelSearch.trim()}
        <span class="filter-count">{t("{0} of {1}", [models.length, allIds.length])}</span>
      {/if}
      <SelectBox
        checked={allVisibleSelected}
        variant="all"
        label={t("Select all visible models")}
        caption={allVisibleSelected ? t("Clear selection") : t("Select")}
        onchange={toggleAll}
      />
    </div>

    {#if confirmActualize}
      <div class="st-confirm">
        <span>{t("Refresh the catalog for “{0}”? Names and connection settings will be kept, and unsaved changes will remain in the draft.", [provider.name || providerId])}</span>
        <div class="st-confirm-actions">
          <button class="st-btn st-btn--quiet st-btn--sm" type="button" onclick={clearActualize}> {t("Cancel")} </button>
          <button
            class="st-btn st-btn--quiet st-btn--sm"
            type="button"
            onclick={() => {
              confirmActualize = false;
              void settings.actualizeProvider(providerId);
            }}
          > {t("Update")} </button>
        </div>
      </div>
    {/if}

    {#if update}
      <p class="update-note" class:is-error={!update.probe.text} title={probeTitle()}>
        <Icon name={update.probe.text ? "check" : "x"} size={13} /> {t("Updated: +{0} · −{1} · changed {2}.", [update.added.length, update.removed.length, update.updated.length])} </p>
      <details class="st-details">
        <summary>{t("Catalog changes")}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
        <div class="st-details-body">
          {#each [{ label: t("Added models"), ids: update.added }, { label: t("Changed models"), ids: update.updated }, { label: t("Removed models"), ids: update.removed }] as group (group.label)}
            {#if group.ids.length > 0}<p class="st-hint">{group.label}: {group.ids.join(", ")}</p>{/if}
          {/each}
          {#each update.warnings as warning (warning)}<p class="st-hint">{warning}</p>{/each}
        </div>
      </details>
    {/if}

    {#if addOpen}
      <ModelAddForm {provider} onadded={added} onclose={() => (addOpen = false)} />
    {/if}

    {#if selectedIds.length > 0}
      <ModelBulkBar
        count={selectedIds.length}
        canDelete={canDeleteSelected}
        providerName={provider.name || providerId}
        onenable={setEnabled}
        ondelete={removeSelected}
        onclear={() => (selected = {})}
      />
    {/if}

    <div class="model-list">
      {#each models as [modelId, model] (modelId)}
        <ModelRow
          {modelId}
          {model}
          current={isCurrent(modelId)}
          selected={selected[modelId] === true}
          onselect={(checked) => toggleSelected(modelId, checked)}
          onedit={() => (editingModel = modelId)}
          onkeydown={(event) => onModelKeydown(event, modelId)}
        />
      {/each}

      {#if models.length === 0}
        <div class="st-empty">
          <span>
            {modelSearch.trim() || filter !== "all"
              ? t("No models found.")
              : t("No models.")}
          </span>
        </div>
      {/if}
    </div>
  </section>
{/if}

{#if editingModel}
  <ModelEditor
    providerId={providerId}
    modelId={editingModel}
    onClose={() => (editingModel = null)}
  />
{/if}

<style>
  .models {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .models-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .models-tools .st-search {
    flex: 1;
    min-width: 0;
  }

  .filters {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .model-filter {
    width: 180px;
    min-height: 32px;
    font-size: 12.5px;
  }

  .filter-count {
    margin-left: auto;
    color: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .update-note {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .update-note.is-error {
    color: var(--error);
  }

  .model-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 4px;
  }

  @media (max-width: 900px) {
    .filter-count {
      margin-left: 0;
    }
  }
</style>
