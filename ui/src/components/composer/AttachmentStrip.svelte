<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { formatBytes } from "../../lib/composer/queue";
  import type { Attachment, AttachmentKind } from "../../lib/composer/types";
  import Icon from "../Icon.svelte";
  import "./composer.css";

  interface Props {
    attachments: readonly Attachment[];
    disabled?: boolean;
    onRemove: (id: string) => void;
  }

  let { attachments, disabled = false, onRemove }: Props = $props();

  const kindLabels: Record<AttachmentKind, string> = $derived({
    audio: t("Audio"),
    image: t("Image"),
    pdf: "PDF",
    text: t("Text"),
    folder: t("Folder"),
    file: t("File"),
  });
</script>

{#if attachments.length > 0}
  <div class="lh-attachments">
    <div class="lh-attachment-list" role="list" aria-label={t("Attachments")}>
      {#each attachments as attachment (attachment.id)}
        <div class="lh-attachment" role="listitem">
          <span class="lh-att-thumb">
            {#if attachment.kind === "image" && attachment.previewUrl}
              <img src={attachment.previewUrl} alt="" />
            {:else}
              <Icon name={attachment.kind === "folder" ? "folder" : "file"} size={17} />
            {/if}
          </span>
          <span class="lh-att-body">
            <span class="lh-att-name" title={attachment.name}>{attachment.name}</span>
            <span class="lh-att-meta">
              {attachment.kind === "folder"
                ? kindLabels.folder
                : `${kindLabels[attachment.kind]} · ${formatBytes(attachment.size)}`}
            </span>
          </span>
          <button
            class="lh-icon-button lh-att-remove"
            type="button"
            title={t("Remove {0}", [attachment.name])}
            aria-label={t("Remove {0}", [attachment.name])}
            {disabled}
            onclick={() => onRemove(attachment.id)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      {/each}
    </div>


  </div>
{/if}
