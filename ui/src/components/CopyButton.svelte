<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { onDestroy } from "svelte";
  import { CopyFeedback } from "../lib/clipboard.svelte";
  import MorphIcon from "./MorphIcon.svelte";

  interface Props {
    text: string | (() => string | Promise<string>);
    label: string;
    caption?: string;
    pendingLabel?: string;
    disabled?: boolean;
  }

  let { text, label, caption, pendingLabel = t("Copying…"), disabled = false }: Props = $props();
  const feedback = new CopyFeedback();
  const title = $derived(feedback.copied ? t("Copied") : label);
  onDestroy(() => feedback.dispose());
</script>

<button
  class={caption ? "st-btn st-btn--quiet copy-button" : "st-icon-btn copy-button"}
  class:is-copied={feedback.copied}
  type="button"
  aria-label={title}
  {title}
  aria-busy={feedback.pending}
  disabled={disabled || feedback.pending}
  onclick={() => feedback.copy(text)}
>
  <MorphIcon name={feedback.copied ? "check" : "copy"} size={14} stroke={feedback.copied ? 2.2 : 1.7} />
  {#if caption}
    <span class="copy-caption" aria-hidden="true">
      <span class:is-visible={!feedback.pending && !feedback.copied}>{caption}</span>
      <span class:is-visible={feedback.pending}>{pendingLabel}</span>
      <span class:is-visible={feedback.copied}>{t("Copied")}</span>
    </span>
  {/if}
</button>

<style>
  .copy-button.is-copied { color: var(--success); }
  .copy-button:disabled { opacity: 0.45; }
  .copy-caption { display: grid; }
  .copy-caption > span { grid-area: 1 / 1; visibility: hidden; }
  .copy-caption > .is-visible { visibility: visible; }
</style>
