<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { tick } from "svelte";
  import type { QueuedMessage, SendMode } from "../../lib/composer/types";
  import type { IconName } from "../../lib/types";
  import Icon from "../Icon.svelte";
  import "./composer.css";

  interface Props {
    items: readonly QueuedMessage[];
    onEdit: (id: string, text: string) => void;
    onRemove: (id: string) => void;
  }

  let { items, onEdit, onRemove }: Props = $props();

  let editingId = $state<string | null>(null);
  let draft = $state("");
  let editor = $state<HTMLTextAreaElement | null>(null);

  const modeLabels: Record<SendMode, string> = $derived({
    queue: t("Queue"),
    steer: t("Guide now"),
  });

  const modeIcons: Record<SendMode, IconName> = {
    queue: "tasks",
    steer: "spark",
  };

  async function startEdit(item: QueuedMessage): Promise<void> {
    editingId = item.id;
    draft = item.text;
    await tick();
    editor?.focus();
    editor?.select();
  }

  function cancelEdit(): void {
    editingId = null;
    draft = "";
  }

  function save(item: QueuedMessage): void {
    if (draft.trim().length === 0) return;
    onEdit(item.id, draft);
    cancelEdit();
  }

  function onEditorKeydown(event: KeyboardEvent, item: QueuedMessage): void {
    if (event.isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      save(item);
    }
  }
</script>

{#if items.length > 0}
  <section class="lh-queue" aria-label={t("Message queue")}>
    <div class="lh-queue-head">
      <span>{t("Queue")}</span>
      <span class="lh-queue-count">{items.length}</span>
    </div>
    {#each items as item (item.id)}
      <div
        class="lh-queue-row"
        class:is-sending={item.state === "sending"}
      >
        {#if editingId === item.id}
          <div class="lh-queue-editor">
            <label class="sr-only" for={`queue-edit-${item.id}`}>{t("Message text")}</label>
            <textarea
              id={`queue-edit-${item.id}`}
              class="lh-queue-input"
              bind:this={editor}
              bind:value={draft}
              rows={2}
              onkeydown={(event) => onEditorKeydown(event, item)}
            ></textarea>
            <div class="lh-queue-editor-actions">
              <button class="lh-text-button" type="button" onclick={cancelEdit}>{t("Cancel")}</button>
              <button
                class="lh-primary-button"
                type="button"
                disabled={draft.trim().length === 0}
                onclick={() => save(item)}
              > {t("Save")} </button>
            </div>
          </div>
        {:else}
          <div class="lh-queue-body">
            <span class="lh-queue-mode" role="img" aria-label={modeLabels[item.mode]} title={modeLabels[item.mode]}>
              <Icon name={modeIcons[item.mode]} size={14} />
            </span>
            <span class="lh-queue-text" title={item.text}>{item.text}</span>
            {#if item.state === "sending"}
              <span class="lh-queue-state">{t("Sending")}</span>
            {/if}
          </div>
          {#if item.state === "pending"}
            <div class="lh-queue-actions">
              <button
                class="lh-icon-button"
                type="button"
                title={t("Edit message")}
                aria-label={t("Edit message")}
                onclick={() => startEdit(item)}
              >
                <Icon name="edit" size={15} />
              </button>
              <button
                class="lh-icon-button"
                type="button"
                title={t("Delete message")}
                aria-label={t("Delete message")}
                onclick={() => onRemove(item.id)}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          {/if}
        {/if}
      </div>
    {/each}
  </section>
{/if}
