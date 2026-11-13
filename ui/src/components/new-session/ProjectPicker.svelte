<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import type { NewSessionProject } from "../../lib/new-session";
  import Icon from "../Icon.svelte";
  import "./project-picker.css";

  interface Props {
    current: NewSessionProject | null;
    recent: NewSessionProject[];
    onSelect: (id: string) => void;
    onChooseFolder: () => void;
  }

  let { current, recent, onSelect, onChooseFolder }: Props = $props();

  let open = $state(false);
  let root: HTMLDetailsElement;
  let trigger: HTMLElement;

  const currentName = $derived(current?.name ?? t("No project selected"));
  const currentPath = $derived(current?.path ?? t("Select a project folder"));

  function select(id: string): void {
    open = false;
    if (id !== current?.id) onSelect(id);
  }

  function chooseFolder(): void {
    open = false;
    onChooseFolder();
  }

  function onDocumentClick(event: MouseEvent): void {
    if (!open || !root) return;
    if (event.target instanceof Node && root.contains(event.target)) return;
    open = false;
  }

  function onDocumentKeydown(event: KeyboardEvent): void {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    open = false;
    trigger?.focus();
  }
</script>

<svelte:document onclick={onDocumentClick} onkeydown={onDocumentKeydown} />

<details class="ns-picker" bind:this={root} bind:open={open}>
  <summary class="ns-picker-trigger" bind:this={trigger} title={currentPath}>
    <Icon name="folder" size={16} />
    <span class="ns-picker-text">
      <span class="ns-picker-name" title={currentName}>{currentName}</span>
    </span>
    <span class="ns-picker-chevron" aria-hidden="true">
      <Icon name="chevron-down" size={13} />
    </span>
  </summary>

  <div class="ns-picker-menu">
    {#if recent.length > 1}<div class="ns-picker-head">{t("Recent projects")}</div>{/if}
    {#if recent.length > 0}
      <div class="ns-picker-list">
        {#each recent as project (project.id)}
          <button
            class="ns-picker-row"
            class:is-current={project.id === current?.id}
            type="button"
            aria-current={project.id === current?.id ? "true" : undefined}
            onclick={() => select(project.id)}
          >
            <Icon name="folder" size={15} />
            <span class="ns-picker-row-text">
              <span class="ns-picker-row-name" title={project.name}>{project.name}</span>
              {#if project.path}
                <span class="ns-picker-row-path" title={project.path}>{project.path}</span>
              {/if}
            </span>
            {#if project.id === current?.id}
              <Icon name="check" size={13} />
            {/if}
          </button>
        {/each}
      </div>
    {:else}
      <p class="ns-picker-empty">{t("No other projects yet")}</p>
    {/if}
    <button class="ns-picker-choose" type="button" onclick={chooseFolder}>
      <Icon name="folder-plus" size={15} />
      <span>{t("Select folder")}</span>
    </button>
  </div>
</details>
