<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { filterCommands, parseCommandQuery } from "../../lib/composer/commands";
  import type { CommandItem, SkillCommand } from "../../lib/composer/types";
  import { suggestionList } from "../../lib/composer/suggestion-list";
  import "./composer.css";

  interface Props {
    id?: string;
    query: string;
    skills?: readonly SkillCommand[];
    onSelect: (command: CommandItem, args: string) => void;
    onClose: () => void;
  }

  let { id = "slash-menu", query, skills = [], onSelect, onClose }: Props = $props();

  interface GroupRow {
    type: "group";
    key: string;
    label: string;
  }

  interface ItemRow {
    type: "item";
    command: CommandItem;
    index: number;
  }

  type Row = GroupRow | ItemRow;

  let active = $state(0);

  const parsed = $derived(parseCommandQuery(query));
  const matches = $derived(filterCommands(parsed.name, skills));
  const activeIndex = $derived(Math.min(active, Math.max(0, matches.length - 1)));

  const rows = $derived.by(() => {
    const result: Row[] = [];
    let index = 0;

    for (const [source, label] of [
      ["builtin", t("Commands")],
      ["skill", t("Skills")],
    ] as const) {
      const group = matches.filter((command) => command.source === source);
      if (group.length === 0) continue;

      result.push({ type: "group", key: source, label });
      for (const command of group) {
        result.push({ type: "item", command, index });
        index += 1;
      }
    }

    return result;
  });

  $effect(() => {
    void query;
    void skills;
    active = 0;
  });
</script>

<div class="lh-menu lh-slash-menu" {id} role="listbox" aria-label={t("Commands and skills")}
  use:suggestionList={{ count: matches.length, active: activeIndex, onMove: (index) => active = index,
    onSelect: (index) => { const command = matches[index]; if (command) onSelect(command, parsed.args); }, onClose }}
>
  {#if matches.length === 0}
    <div class="lh-menu-empty" role="status">{t("Command not found")}</div>
  {:else}
    {#each rows as row (row.type === "group" ? `group-${row.key}` : row.command.name)}
      {#if row.type === "group"}
        <div class="lh-menu-group">{row.label}</div>
      {:else}
        <button
          class="lh-menu-row lh-slash-row"
          class:is-active={row.index === activeIndex}
          id={`${id}-option-${row.index}`}
          type="button"
          role="option"
          aria-selected={row.index === activeIndex}
          tabindex="-1"
          onmousedown={(event) => event.preventDefault()}
          onmouseenter={() => (active = row.index)}
          onclick={() => onSelect(row.command, parsed.args)}
        >
          <span class="lh-command-head">
            <span class="lh-command-name">/{row.command.name}</span>
            {#if row.command.hint}
              <span class="lh-command-hint">{row.command.hint}</span>
            {/if}
            {#if row.command.source === "skill"}
              <span class="lh-command-source">{t("skill")}</span>
            {/if}
          </span>
          <span class="lh-command-desc">{row.command.description}</span>
        </button>
      {/if}
    {/each}
  {/if}
</div>
