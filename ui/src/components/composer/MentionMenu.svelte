<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { filterMentions } from "../../lib/composer/mentions";
  import type { MentionItem } from "../../lib/composer/types";
  import FileTypeBadge from "../FileTypeBadge.svelte";
  import Icon from "../Icon.svelte";
  import { suggestionList } from "../../lib/composer/suggestion-list";
  import "./composer.css";

  interface Props {
    id?: string;
    items: readonly MentionItem[];
    query: string;
    limit?: number;
    onSelect: (item: MentionItem) => void;
    onClose: () => void;
  }

  let {
    id = "mention-menu",
    items,
    query,
    limit = 10,
    onSelect,
    onClose,
  }: Props = $props();

  interface GroupRow {
    type: "group";
    key: string;
    label: string;
  }

  interface ItemRow {
    type: "item";
    item: MentionItem;
    index: number;
  }

  type Row = GroupRow | ItemRow;

  let active = $state(0);

  const groups = $derived([["selection", t("Selection")], ["symbol", t("Symbol")], ["task", t("Tasks")], ["pull-request", t("Pull requests")], ["mcp-resource", t("MCP resources")], ["file", t("Files")], ["folder", t("Folders")]] as const);
  const matches = $derived(filterMentions(query, items, limit).sort((left, right) => groups.findIndex(([kind]) => kind === left.kind) - groups.findIndex(([kind]) => kind === right.kind)));
  const activeIndex = $derived(Math.min(active, Math.max(0, matches.length - 1)));

  const rows = $derived.by(() => {
    const result: Row[] = [];
    let index = 0;

    for (const [kind, label] of groups) {
      const group = matches.filter((item) => item.kind === kind);
      if (group.length === 0) continue;

      result.push({ type: "group", key: kind, label });
      for (const item of group) {
        result.push({ type: "item", item, index });
        index += 1;
      }
    }

    return result;
  });

  $effect(() => {
    void query;
    void items;
    active = 0;
  });

  function nameOf(path: string): string {
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return slash >= 0 ? path.slice(slash + 1) : path;
  }

  function dirOf(path: string): string {
    const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return slash > 0 ? path.slice(0, slash) : t("project root");
  }
</script>

<div class="lh-menu lh-mention-menu" {id} role="listbox" aria-label={t("Context")}
  use:suggestionList={{ count: matches.length, active: activeIndex, onMove: (index) => active = index,
    onSelect: (index) => { const item = matches[index]; if (item) onSelect(item); }, onClose }}
>
  {#if matches.length === 0}
    <div class="lh-menu-empty" role="status">{t("No results")}</div>
  {:else}
    {#each rows as row (row.type === "group" ? `group-${row.key}` : `${row.item.kind}:${row.item.path}`)}
      {#if row.type === "group"}
        <div class="lh-menu-group">{row.label}</div>
      {:else}
        <button
          class="lh-menu-row lh-mention-row"
          class:is-active={row.index === activeIndex}
          id={`${id}-option-${row.index}`}
          type="button"
          role="option"
          aria-selected={row.index === activeIndex}
          tabindex="-1"
          onmousedown={(event) => event.preventDefault()}
          onmouseenter={() => (active = row.index)}
          onclick={() => onSelect(row.item)}
        >
          <span class="lh-mention-icon">
            {#if row.item.kind === "folder"}
              <Icon name="folder" size={16} />
            {:else if row.item.fileKind}
              <FileTypeBadge kind={row.item.fileKind} size={16} />
            {:else}
              <Icon name="file" size={16} />
            {/if}
          </span>
          <span class="lh-mention-body">
            <span class="lh-mention-name">{row.item.label ?? nameOf(row.item.path)}</span>
            <span class="lh-mention-path">{dirOf(row.item.path)}</span>
            {#if row.item.preview}
              <span class="lh-mention-preview">{row.item.preview}</span>
            {/if}
          </span>
        </button>
      {/if}
    {/each}
  {/if}
</div>
