<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { onMount, tick } from "svelte";
  import { formatModelName } from "../lib/model-name";
  import { modelCapabilities } from "../lib/model-capabilities";
  import {
    FAVORITES_LIMIT, type ModelRef, readFavorites, saveFavorites,
    readCollapsedProviders, saveCollapsedProviders,
  } from "../lib/model-picker-preferences";
  import type { ProviderInfo } from "../lib/types";
  import { MODEL_PICKER_EVENT } from "../lib/ui-polish";
  import Icon from "./Icon.svelte";
  import FloatingMenu from "./FloatingMenu.svelte";
  import "./model-picker.css";

  interface Props {
    providers: ProviderInfo[];
    provider: string;
    model: string;
    disabled?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    /** Opens on the `/model` slash command. Only the composer picker listens. */
    listenOpenRequests?: boolean;
    onSelect: (provider: string, model: string) => void;
  }

  interface QuickModel extends ModelRef {
    providerName: string;
    name: string;
  }

  interface FlatRow extends ModelRef {
    name: string;
  }

  let {
    providers,
    provider,
    model,
    disabled = false,
    placeholder,
    ariaLabel,
    listenOpenRequests = false,
    onSelect,
  }: Props = $props();

  const pickerId = $props.id();
  let open = $state(false);
  let query = $state("");
  let cursor = $state(0);
  let favorites = $state<ModelRef[]>([]);
  let collapsedProviders = $state<string[]>([]);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let searchEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);

  const activeProvider = $derived(providers.find((entry) => entry.id === provider));
  const activeModel = $derived(activeProvider?.models[model]);
  const label = $derived(activeModel?.name ?? (model ? formatModelName(model) : placeholder ?? t("Select a model")));
  const searching = $derived(query.trim().length > 0);
  const groups = $derived(
    providers
      .map((entry) => {
        const needle = query.trim().toLowerCase();
        const models = Object.entries(entry.models).filter(([id, info]) => {
          if (info.disabled) return false;
          if (!needle) return true;
          return (
            id.toLowerCase().includes(needle) ||
            (info.name ?? "").toLowerCase().includes(needle) ||
            entry.name.toLowerCase().includes(needle)
          );
        });
        return {
          ...entry, visibleModels: models,
          expanded: searching || !collapsedProviders.includes(entry.id),
        };
      })
      .filter((entry) => entry.visibleModels.length > 0),
  );
  const flat = $derived<FlatRow[]>(
    groups.filter((group) => group.expanded).flatMap((group) =>
      group.visibleModels.map(([id, info]) => ({
        provider: group.id,
        model: id,
        name: info.name ?? formatModelName(id),
      })),
    ),
  );
  const favoriteKeys = $derived(new Set(favorites.map(refKey)));
  const quickFavorites = $derived(resolveRefs(favorites));

  function refKey(ref: ModelRef): string {
    return `${ref.provider}\u0000${ref.model}`;
  }

  function resolveRefs(refs: ModelRef[]): QuickModel[] {
    const result: QuickModel[] = [];
    for (const ref of refs) {
      const entry = providers.find((candidate) => candidate.id === ref.provider);
      const info = entry?.models[ref.model];
      if (!entry || !info || info.disabled) continue;
      result.push({
        ...ref,
        providerName: entry.name,
        name: info.name ?? formatModelName(ref.model),
      });
    }
    return result;
  }

  function toggleFavorite(ref: ModelRef): void {
    const key = refKey(ref);
    favorites = favoriteKeys.has(key)
      ? favorites.filter((entry) => refKey(entry) !== key)
      : [ref, ...favorites].slice(0, FAVORITES_LIMIT);
    saveFavorites(favorites);
  }

  function toggleProvider(id: string): void {
    collapsedProviders = collapsedProviders.includes(id)
      ? collapsedProviders.filter((entry) => entry !== id)
      : [...collapsedProviders, id];
    saveCollapsedProviders(collapsedProviders);
    cursor = 0;
  }

  function isFavorite(ref: ModelRef): boolean {
    return favoriteKeys.has(refKey(ref));
  }

  function openPicker(): void {
    if (disabled) return;
    open = true;
    query = "";
    collapsedProviders = readCollapsedProviders();
    favorites = readFavorites();
    const index = flat.findIndex(
      (row) => row.provider === provider && row.model === model,
    );
    cursor = index >= 0 ? index : 0;
    void tick().then(() => {
      searchEl?.focus();
      scrollCursorIntoView();
    });
  }

  function closePicker(returnFocus = true): boolean {
    open = false;
    query = "";
    if (returnFocus) void tick().then(() => triggerEl?.focus());
    return false;
  }

  function toggle(): void {
    if (disabled) return;
    if (open) closePicker();
    else openPicker();
  }

  function select(providerId: string, modelId: string): void {
    open = false;
    query = "";
    onSelect(providerId, modelId);
    void tick().then(() => triggerEl?.focus());
  }

  function moveCursor(next: number): void {
    if (flat.length === 0) return;
    cursor = Math.min(flat.length - 1, Math.max(0, next));
    scrollCursorIntoView();
  }

  function scrollCursorIntoView(): void {
    void tick().then(() => {
      listEl
        ?.querySelector<HTMLElement>(`[data-row-index="${cursor}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
      return;
    }
    if (event.key === "Tab" && open) {
      const focusable = Array.from(
        searchEl?.closest(".picker")?.querySelectorAll<HTMLElement>("[data-picker-focus]:not(:disabled)") ?? [],
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.target !== searchEl) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCursor(cursor + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor(cursor - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      moveCursor(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      moveCursor(flat.length - 1);
      return;
    }
    if (event.key === "Enter") {
      const row = flat[cursor];
      if (!row) return;
      event.preventDefault();
      select(row.provider, row.model);
      return;
    }
  }

  $effect(() => {
    query;
    cursor = 0;
  });

  onMount(() => {
    favorites = readFavorites();
    collapsedProviders = readCollapsedProviders();
    if (!listenOpenRequests) return;
    const onOpenRequest = (event: Event): void => {
      openPicker();
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      if (detail?.query) query = detail.query;
    };
    window.addEventListener(MODEL_PICKER_EVENT, onOpenRequest);
    return () => window.removeEventListener(MODEL_PICKER_EVENT, onOpenRequest);
  });
</script>

<div class="model-picker">
  <button
    class="model-button"
    type="button"
    class:is-open={open}
    aria-label={ariaLabel}
    aria-haspopup="dialog"
    aria-expanded={open}
    title={`${activeProvider?.name ?? t("Provider")} · ${model}`}
    {disabled}
    bind:this={triggerEl}
    onclick={toggle}
  >
    <span class="model-name">{label}</span>
    <span class="chevron"><Icon name="chevron-down" size={11} /></span>
  </button>

  {#if open}
    <FloatingMenu
      anchor={triggerEl}
      label={t("Select model")}
      class="picker"
      width={304}
      maxHeight={328}
      onClose={() => { closePicker(false); }}
      onkeydown={onKeydown}
    >
      <div class="search">
        <Icon name="search" size={14} />
        <input
          bind:this={searchEl}
          bind:value={query}
          data-picker-focus
          role="combobox"
          aria-expanded={open}
          aria-controls={groups.map((group) => `${pickerId}-models-${group.id}`).join(" ") || undefined}
          aria-autocomplete="list"
          aria-activedescendant={flat[cursor] ? `${pickerId}-row-${cursor}` : undefined}
          placeholder={t("Search models or providers")}
          aria-label={t("Search models or providers")}
          spellcheck="false"
        />
      </div>

      {#if query.trim().length === 0 && quickFavorites.length > 0}
        <div class="quick">
          {#each quickFavorites as entry (refKey(entry))}
            <button
              class="quick-chip"
              type="button"
              data-picker-focus
              title={`${entry.providerName} · ${entry.model}`}
              onclick={() => select(entry.provider, entry.model)}
            >
              <span class="quick-star" aria-hidden="true"><Icon name="star" size={11} /></span>
              {entry.name}
            </button>
          {/each}
        </div>
      {/if}

      <div class="list" bind:this={listEl}>
        {#each groups as group, groupIndex (group.id)}
          {@const offset = groups
            .slice(0, groupIndex)
            .reduce((sum, entry) => sum + (entry.expanded ? entry.visibleModels.length : 0), 0)}
          <div class="group">
            <button
              class="group-head"
              id={`${pickerId}-provider-${group.id}`}
              type="button"
              data-picker-focus
              aria-expanded={group.expanded}
              aria-controls={`${pickerId}-models-${group.id}`}
              disabled={searching}
              title={searching ? t("Search shows all matches") : undefined}
              onclick={() => toggleProvider(group.id)}
            >
              <Icon name={group.expanded ? "chevron-down" : "chevron-right"} size={12} />
              <span class="group-name">{group.name}</span>
              <span class="group-count" aria-label={t("{0} models", [group.visibleModels.length])}>{group.visibleModels.length}</span>
            </button>
            <div
              id={`${pickerId}-models-${group.id}`}
              role="listbox"
              aria-labelledby={`${pickerId}-provider-${group.id}`}
              hidden={!group.expanded}
            >
            {#if group.expanded}
            {#each group.visibleModels as [id, info], index (id)}
              {@const rowIndex = offset + index}
              {@const capabilities = modelCapabilities(info)}
              <div class="row-wrap" class:is-cursor={cursor === rowIndex}>
                <button
                  class="row"
                  class:is-active={group.id === provider && id === model}
                  id={`${pickerId}-row-${rowIndex}`}
                  data-row-index={rowIndex}
                  type="button"
                  role="option"
                  tabindex="-1"
                  aria-selected={group.id === provider && id === model}
                  title={`${group.name} · ${id}`}
                  onclick={() => select(group.id, id)}
                >
                  <span class="row-name">{info.name ?? formatModelName(id)}</span>
                  {#if capabilities.length > 0}
                    <span class="row-capabilities" aria-label={capabilities.map((capability) => capability.label).join(", ")}>
                      {#each capabilities as capability (capability.label)}
                        <span title={capability.label}><Icon name={capability.icon} size={13} /></span>
                      {/each}
                    </span>
                  {/if}
                  {#if group.id === provider && id === model}
                    <span class="check"><Icon name="check" size={13} /></span>
                  {/if}
                </button>
                <button
                  class="star-btn"
                  class:is-on={isFavorite({ provider: group.id, model: id })}
                  type="button"
                  tabindex="-1"
                  aria-label={isFavorite({ provider: group.id, model: id })
                    ? t("Remove {0} from favorites", [info.name ?? id])
                    : t("Add {0} to favorites", [info.name ?? id])}
                  aria-pressed={isFavorite({ provider: group.id, model: id })}
                  onclick={(event) => {
                    event.stopPropagation();
                    toggleFavorite({ provider: group.id, model: id });
                  }}
                >
                  <Icon name="star" size={14} />
                </button>
              </div>
            {/each}
            {/if}
            </div>
          </div>
        {:else}
          <p class="empty">{t("No results")}</p>
        {/each}
      </div>

    </FloatingMenu>
  {/if}
</div>
