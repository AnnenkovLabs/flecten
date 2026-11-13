<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import Icon from "./Icon.svelte";

  let { mode, onChange }: { mode: "agent" | "ide"; onChange: (mode: "agent" | "ide") => void } = $props();
</script>

<div class="mode-switch" class:is-ide={mode === "ide"} role="group" aria-label={t("Work mode")}>
  <span class="selection" aria-hidden="true"><span class="trail"></span><span class="pill"></span></span>
  <button type="button" aria-pressed={mode === "agent"} onclick={() => onChange("agent")}>
    <span class="mode-icon"><Icon name="brain" size={15} /></span>{t("Agent")} </button>
  <button type="button" aria-pressed={mode === "ide"} onclick={() => onChange("ide")}>
    <Icon name="terminal" size={15} />IDE
  </button>
</div>

<style>
  .mode-switch { display: flex; position: relative; padding: 3px; border-radius: 10px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); -webkit-app-region: no-drag; }
  button { position: relative; z-index: 1; display: flex; gap: 6px; align-items: center; justify-content: center; width: 80px; height: var(--control-h); border-radius: 7px; color: var(--muted); font-size: 13px; font-weight: 600; }
  button[aria-pressed="true"] { color: var(--text); }
  button:active { scale: 1; }
  .mode-icon { display: grid; place-items: center; }
  .selection { position: absolute; inset: 3px; pointer-events: none; filter: url(#goo); }
  .selection span { position: absolute; top: 0; left: 0; width: 80px; height: var(--control-h); border-radius: 7px; background: var(--raised-hover); }
  .pill { transition: transform 360ms cubic-bezier(0.2, 0, 0, 1), border-radius 360ms cubic-bezier(0.2, 0, 0, 1); }
  .trail { transition: transform 480ms cubic-bezier(0.2, 0, 0, 1); }
  .is-ide .selection span { transform: translateX(80px); border-radius: 8px; }
  @media (max-width: 600px) { button { width: 66px; } .selection span { width: 66px; } .is-ide .selection span { transform: translateX(66px); } button :global(.icon) { display: none; } }
  @media (pointer: coarse) { .mode-switch { padding-block: 2px; } .selection { inset-block: 2px; } }
  @media (prefers-reduced-motion: reduce) { .selection span { transition: none; } }
</style>
