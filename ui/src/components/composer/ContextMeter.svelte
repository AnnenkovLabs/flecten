<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { type ContextView, shortTokens } from "../../lib/context-meter.svelte";
  import FloatingMenu from "../FloatingMenu.svelte";
  import ContextUsageDetails from "./ContextUsageDetails.svelte";
  import "./context-meter.css";

  interface Props {
    view: ContextView;
    running: boolean;
    onCompact?: ((focus?: string) => void) | undefined;
  }

  let { view, running, onCompact }: Props = $props();

  let open = $state(false);
  let focus = $state("");
  let button = $state<HTMLButtonElement | null>(null);

  const RADIUS = 7;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const dash = $derived(`${(Math.min(100, view.percent) / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`);
  const label = $derived(view.used > 0 ? `${view.percent}%` : "0%");
  const title = $derived(
    view.window > 0
      ? t("Context: {0} of {1} ({2}%)", [shortTokens(view.used), shortTokens(view.window), view.percent])
      : t("Context"),
  );

  function toggle(): void {
    open = !open;
  }

  function compact(): void {
    if (view.used === 0) return;
    onCompact?.(focus.trim() || undefined);
    focus = "";
    open = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    open = false;
    button?.focus();
  }
</script>

<div class="lh-context" data-level={view.level}>
  <button
    bind:this={button}
    class="lh-context-button"
    type="button"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={title}
    {title}
    onclick={toggle}
  >
    <svg class="lh-context-ring" viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <circle class="lh-context-track" cx="9" cy="9" r={RADIUS} />
      <circle class="lh-context-fill" cx="9" cy="9" r={RADIUS} stroke-dasharray={dash} />
    </svg>
    <span class="lh-context-label">{label}</span>
  </button>
  {#if open}
    <FloatingMenu anchor={button} label={t("Model context")} width={328} maxHeight={540}
      class="lh-context-pop" onClose={() => { open = false; }} onkeydown={onKeydown}>
      <div class="lh-context-head">
        <strong>{t("Context")}</strong>
        <span>{t("{0} of {1} · {2}%", [shortTokens(view.used), shortTokens(view.window), view.percent])}</span>
      </div>
      <div class="lh-context-bar" role="progressbar" aria-label={t("Context")}
        aria-valuenow={view.percent} aria-valuemin={0} aria-valuemax={100}>
        <span style:width={`${Math.min(100, view.percent)}%`}></span>
      </div>
      <p class="lh-context-note">{t("Auto-compaction at {0}%", [view.autoAt])}</p>
      {#if view.usage}
        <ContextUsageDetails details={view.usage} />
      {/if}
      {#if onCompact}
        <label class="lh-context-focus">
          <span>{t("What should the summary focus on?")}</span>
          <input
            type="text"
            bind:value={focus}
            placeholder={t("For example: database migration, without test logs")}
            onkeydown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                compact();
              }
            }}
          />
        </label>
        <button class="lh-context-compact" type="button" onclick={compact} disabled={view.used === 0}>
          {running ? t("Compact before the next request") : t("Compact now")}
        </button>
      {/if}
    </FloatingMenu>
  {/if}
</div>
