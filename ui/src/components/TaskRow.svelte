<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { tick } from "svelte";
  import { requestAgent } from "../lib/desktop";
  import { toast } from "../lib/toast.svelte";
  import { absoluteTime } from "../lib/ui-polish";
  import type { IconName, Task, TaskStatusKind } from "../lib/types";
  import Icon from "./Icon.svelte";
  import MorphIcon from "./MorphIcon.svelte";

  interface Props {
    task: Task;
    active: boolean;
    onSelect: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onDelete: (id: string) => void;
  }

  const TASK_FORK_EVENT = "liquid:task-fork";

  let { task, active, onSelect, onRename, onDelete }: Props = $props();

  const STATUS: Record<TaskStatusKind, { icon: IconName; label: string }> = $derived({
    working: { icon: "spark", label: t("running") },
    done: { icon: "check", label: t("done") },
    review: { icon: "search", label: t("checking") },
    stopped: { icon: "stop", label: t("stopped") },
    error: { icon: "x", label: t("error") },
    waiting: { icon: "key", label: t("waiting") },
    interrupted: { icon: "refresh", label: t("interrupted") },
  });

  let root: HTMLDivElement;
  let input = $state<HTMLInputElement | undefined>(undefined);
  let editing = $state(false);
  let confirming = $state(false);
  let menuOpen = $state(false);
  let draft = $state("");

  const meta = $derived(STATUS[task.status]);
  const rowTitle = $derived(
    [task.title, [task.age, task.updatedAt ? absoluteTime(task.updatedAt) : ""].filter(Boolean).join(" · ")]
      .filter(Boolean)
      .join("\n"),
  );

  function startRename(): void {
    menuOpen = false;
    draft = task.title;
    editing = true;
    void tick().then(() => {
      input?.focus();
      input?.select();
    });
  }

  function commitRename(): void {
    if (!editing) return;
    editing = false;
    const title = draft.trim();
    if (title && title !== task.title) onRename(task.id, title);
  }

  function cancelRename(): void {
    editing = false;
    draft = "";
  }

  function startDelete(): void {
    menuOpen = false;
    confirming = true;
  }

  function startFork(): void {
    menuOpen = false;
    window.dispatchEvent(new CustomEvent(TASK_FORK_EVENT, { detail: { id: task.id } }));
  }

  async function exportTask(): Promise<void> {
    menuOpen = false;
    try {
      const response = await requestAgent({ type: "sessions.export", id: task.id });
      if (!response.ok || !response.exported) throw new Error(response.error ?? t("Could not save history"));
      toast.show(t("History saved: {0}", [response.exported.path]));
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
  }

  function confirmDelete(): void {
    confirming = false;
    onDelete(task.id);
  }

  function onRenameKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  $effect(() => {
    if (!menuOpen && !confirming) return;
    const onPointer = (event: PointerEvent): void => {
      if (root && !root.contains(event.target as Node)) {
        menuOpen = false;
        confirming = false;
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      menuOpen = false;
      confirming = false;
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  });
</script>

<div
  class="task"
  class:is-active={active}
  data-task-active={active ? "true" : undefined}
  bind:this={root}
>
  {#if editing}
    <input
      class="task-rename"
      bind:this={input}
      bind:value={draft}
      maxlength={72}
      aria-label={t("New task name")}
      onkeydown={onRenameKeydown}
      onblur={commitRename}
    />
  {:else if confirming}
    <div class="task-confirm">
      <span>{t("Delete task?")}</span>
      <button class="inline-btn is-danger" type="button" onclick={confirmDelete}>{t("Delete")}</button>
      <button class="inline-btn" type="button" onclick={() => (confirming = false)}>{t("Cancel")}</button>
    </div>
  {:else}
    <button
      class="task-row"
      type="button"
      aria-current={active ? "page" : undefined}
      aria-label={`${task.title}, ${meta.label}`}
      title={rowTitle}
      onclick={() => onSelect(task.id)}
    >
      <span class="task-status {task.status}" title={meta.label}>
        <MorphIcon name={meta.icon} size={12} stroke={2} />
      </span>
      <span class="task-title">{task.title}</span>
    </button>
    <button
      class="task-more"
      type="button"
      aria-label={t("Actions: {0}", [task.title])}
      title={t("Actions")}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
    >
      <Icon name="more" size={15} />
    </button>
  {/if}

  {#if menuOpen}
    <div class="task-menu" role="menu">
      <button class="task-menu-row" type="button" role="menuitem" onclick={startRename}>
        <Icon name="edit" size={14} /> {t("Rename")} </button>
      <button class="task-menu-row" type="button" role="menuitem" onclick={startFork}>
        <Icon name="branch" size={14} /> {t("Fork")} </button>
      <button
        class="task-menu-row is-danger"
        type="button"
        role="menuitem"
        disabled={task.status === "working"}
        onclick={startDelete}
      >
        <Icon name="trash" size={14} /> {t("Delete")} </button>
      <button class="task-menu-row" type="button" role="menuitem" onclick={exportTask}>
        <Icon name="copy" size={14} />{t("Export history")} </button>
    </div>
  {/if}
</div>

<style>
  .task {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    border-radius: 7px;
  }

  .task-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: var(--control-h);
    padding: 0 4px 0 8px;
    border-radius: 7px;
    background: transparent;
    color: var(--text-2);
    font-size: 13px;
    text-align: left;
    transition:
      background 220ms var(--ease),
      color var(--t-touch) var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .task-row:hover {
    border-radius: 11px;
    background: rgba(240, 239, 237, 0.035);
    color: var(--text);
  }

  .task.is-active .task-row {
    background: transparent;
    color: var(--text);
  }

  .task-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-status {
    display: inline-flex;
    align-items: center;
    flex: none;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
  }

  .task-status.working {
    color: var(--primary);
  }

  .task-status.done {
    color: var(--success);
  }

  .task-status.review {
    color: var(--warning);
  }

  .task-status.stopped {
    color: var(--muted);
  }

  .task-status.error {
    color: var(--error);
  }

  .task-status.waiting,
  .task-status.interrupted {
    color: var(--warning);
  }

  .task-more {
    display: grid;
    place-items: center;
    width: var(--control-h);
    height: var(--control-h);
    border-radius: 7px;
    color: var(--muted);
    opacity: 0;
    transition:
      background 220ms var(--ease),
      color 220ms var(--ease),
      opacity 220ms var(--ease),
      border-radius 460ms var(--ease-jelly);
  }

  .task:hover .task-more,
  .task:focus-within .task-more,
  .task-more[aria-expanded="true"] {
    opacity: 1;
  }

  .task-more:hover {
    border-radius: 10px;
    background: rgba(240, 239, 237, 0.05);
    color: var(--text-2);
  }

  .task-rename {
    grid-column: 1 / -1;
    width: 100%;
    height: var(--control-h);
    margin: 0;
    padding: 0 9px;
    border: 0;
    border-radius: 7px;
    outline: 1px solid var(--primary);
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
  }

  .task-confirm {
    display: flex;
    grid-column: 1 / -1;
    align-items: center;
    gap: 4px;
    min-height: var(--control-h);
    padding: 0 4px 0 8px;
    color: var(--text-2);
    font-size: 12.5px;
  }

  .task-confirm > span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inline-btn {
    position: relative;
    height: var(--control-h);
    padding: 0 6px;
    border-radius: 7px;
    background: var(--raised);
    color: var(--text-2);
    font-size: 12px;
    white-space: nowrap;
  }

  .inline-btn:hover {
    background: var(--raised-hover);
    color: var(--text);
  }

  .inline-btn.is-danger {
    color: var(--error);
  }

  .task-menu {
    display: grid;
    grid-column: 1 / -1;
    gap: 2px;
    padding: 4px;
    border-radius: 10px;
    background: var(--surface);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.07),
      inset 0 1px 0 rgba(240, 239, 237, 0.06);
  }

  .task-menu-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: var(--control-h);
    padding: 0 8px;
    border-radius: 7px;
    color: var(--text-2);
    font-size: 12.5px;
    text-align: left;
  }

  .task-menu-row:hover:not(:disabled) {
    background: rgba(240, 239, 237, 0.06);
    color: var(--text);
  }

  .task-menu-row:disabled {
    opacity: 0.4;
  }

  .task-menu-row.is-danger {
    color: var(--error);
  }
</style>
