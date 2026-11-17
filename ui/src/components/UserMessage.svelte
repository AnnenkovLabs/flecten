<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import type { MessageVersions } from "../lib/message-types";
  import { relativeTime, timeTitle } from "../lib/ui-polish";
  import Icon from "./Icon.svelte";

  interface Props {
    text: string;
    at?: string | undefined;
    now?: number;
    versions?: MessageVersions | undefined;
    disabled?: boolean;
    onEdit?: ((text: string) => void) | undefined;
    onSelectVersion?: ((variantId: string) => Promise<boolean>) | undefined;
  }

  let { text, at, now = Date.now(), versions, disabled = false, onEdit, onSelectVersion }: Props = $props();
  let pending = $state(false);
  let error = $state("");
  const locked = $derived(disabled || pending);
  const disabledTitle = $derived(t("Wait for the current work to finish before changing history."));

  $effect(() => {
    text;
    versions?.variantId;
    error = "";
  });

  async function selectVersion(index: number): Promise<void> {
    const variantId = versions?.variants[index];
    if (locked || !variantId || !onSelectVersion) return;
    pending = true;
    error = "";
    try {
      if (!(await onSelectVersion(variantId))) error = t("Could not switch versions. Try again.");
    } catch {
      error = t("Could not switch versions. Try again.");
    } finally {
      pending = false;
    }
  }
</script>

<div class="msg user">
  <div class="message-content">
    <div class="bubble">{text}</div>
    {#if onEdit || (versions && versions.count > 1)}
      <div class="message-actions">
        {#if versions && versions.count > 1}
          <div class="message-versions" role="group" aria-label={t("Message versions")}>
            <button class="st-icon-btn history-button" type="button" disabled={locked || versions.index === 0} data-tooltip={disabled ? disabledTitle : t("Previous version")} aria-label={t("Previous version")} onclick={() => selectVersion(versions!.index - 1)}>
              <span class="previous"><Icon name="chevron-right" size={14} /></span>
            </button>
            <span class="version-count" aria-label={t("Version {0} of {1}", [versions.index + 1, versions.count])}>{versions.index + 1}/{versions.count}</span>
            <button class="st-icon-btn history-button" type="button" disabled={locked || versions.index + 1 >= versions.count} data-tooltip={disabled ? disabledTitle : t("Next version")} aria-label={t("Next version")} onclick={() => selectVersion(versions!.index + 1)}>
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        {/if}
        {#if onEdit}
          <button class="st-icon-btn history-button edit-message" type="button" disabled={locked} data-tooltip={disabled ? disabledTitle : t("Edit message")} aria-label={t("Edit message")} onclick={() => { if (!locked) onEdit?.(text); }}><Icon name="edit" size={15} /></button>
        {/if}
      </div>
    {/if}
    {#if at}<time class="msg-time" datetime={at} data-tooltip={timeTitle(at, new Date(now))}>{relativeTime(at, new Date(now))}</time>{/if}
    {#if error}<p class="st-error" role="alert">{error}</p>{/if}
  </div>
</div>

<style>
  .msg-time { display: block; margin-top: 6px; color: var(--muted); font-size: 12px; line-height: 1.3; text-align: right; }
  .msg.user {
    display: flex;
    justify-content: flex-end;
  }

  .message-content {
    min-width: 0;
    max-width: 85%;
  }

  .bubble {
    position: relative;
    padding: 2px 0 2px 14px;
    color: var(--text-body);
    font-size: 16px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    text-wrap: pretty;
  }

  .bubble::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    border-radius: 2px;
    background: var(--primary);
    content: "";
  }

  .message-actions,
  .message-versions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }

  .message-actions {
    margin-top: 4px;
  }

  .history-button {
    width: var(--control-sm-h);
    height: var(--control-sm-h);
  }

  .history-button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .previous {
    display: grid;
    transform: rotate(180deg);
  }

  .version-count {
    min-width: 3ch;
    color: var(--muted);
    text-align: center;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

</style>
