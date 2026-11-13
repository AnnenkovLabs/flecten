<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { cubicOut } from "svelte/easing";
  import { fade, fly } from "svelte/transition";
  import { reducedMotion } from "../lib/media.svelte";
  import { toast } from "../lib/toast.svelte";
  import Icon from "./Icon.svelte";

  // Reduced motion keeps the fade and drops the rise.
  const enter = $derived(
    reducedMotion.current ? { y: 0, duration: 160 } : { y: 5, duration: 180, easing: cubicOut },
  );
</script>

<!-- Sits on top of the dock it is placed in, so it never covers the composer or the run strip. -->
<div class="toasts" aria-live="polite">
  {#each toast.items as item (item.id)}
    <div
      class="toast"
      class:is-error={item.tone === "error"}
      role="group"
      in:fly={enter}
      out:fade={{ duration: 180 }}
      onpointerenter={() => toast.pause()}
      onpointerleave={() => toast.resume()}
      onfocusin={() => toast.pause()}
      onfocusout={() => toast.resume()}
    >
      <span class="toast-text">{item.text}</span>
      <button
        class="toast-dismiss"
        type="button"
        aria-label={t("Dismiss notification")}
        title={t("Hide")}
        onclick={() => toast.dismiss(item.id)}
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 10px);
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: max-content;
    max-width: min(460px, calc(100vw - 48px));
    transform: translateX(-50%);
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 6px 6px 6px 13px;
    border-radius: 11px;
    background: var(--raised);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.08),
      0 8px 24px rgba(0, 0, 0, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    color: var(--text-2);
    font-size: 12.5px;
    line-height: 1.4;
    pointer-events: auto;
  }

  .toast.is-error {
    box-shadow:
      0 0 0 1px rgba(226, 162, 162, 0.32),
      0 8px 24px rgba(0, 0, 0, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    color: var(--text);
  }

  .toast.is-error::before {
    content: "";
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--error);
  }

  .toast-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .toast-dismiss {
    display: grid;
    flex: none;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition:
      background-color var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease);
  }

  .toast-dismiss:hover {
    background: rgba(240, 239, 237, 0.08);
    color: var(--text);
  }

  .toast-dismiss:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }
</style>
