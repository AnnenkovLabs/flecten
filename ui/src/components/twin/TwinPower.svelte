<script lang="ts">
  import type { TwinStore } from "../../lib/twin.svelte";
  import { t } from "../../lib/i18n.svelte";

  let { twin }: { twin: TwinStore } = $props();
  const enabled = $derived(twin.enabled);
  const status = $derived(
    !twin.snapshot ? t("Loading Twin…")
      : twin.power.phase === "reviving" ? t("Twin is back with you")
      : twin.power.phase === "pleading" || twin.power.phase === "falling" ? t("Twin is saying goodbye…")
      : enabled ? t("Twin is on") : t("Twin is off"),
  );
</script>

<div class="twin-power" data-testid="twin-power" data-phase={twin.power.phase}>
  <div class="power-copy">
    <strong aria-live="polite">{status}</strong>
    <p>{enabled ? t("Represents you while you work.") : t("Your character stays saved. Turn Twin on whenever you want.")}</p>
  </div>
  <button class="power-switch" type="button" role="switch" aria-checked={enabled}
    aria-label={t("Use Twin in this project")} disabled={(twin.busy && !twin.configuring) || !twin.snapshot}
    onclick={() => twin.configure(!enabled)}>
    <span class="power-track" aria-hidden="true"><span class="power-knob"></span></span>
    <span class="power-label">{enabled ? t("On") : t("Off")}</span>
  </button>
</div>

<style>
  .twin-power { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin: 0 32px 16px; padding: 16px 20px; border-radius: 12px; background: var(--surface); box-shadow: inset 0 1px 0 var(--line); }
  .power-copy { min-width: 0; }
  strong { display: block; font-size: 15px; font-weight: 600; line-height: 1.4; }
  p { margin: 4px 0 0; font-size: 12px; color: var(--text-2); line-height: 1.5; text-wrap: pretty; }
  .power-switch { display: flex; flex: none; align-items: center; gap: 12px; min-height: 48px; padding: 2px 0 2px 4px; border: 0; background: transparent; border-radius: 8px; color: var(--text); }
  .power-track { position: relative; display: block; width: 76px; height: 42px; border-radius: 24px; background: var(--raised); box-shadow: inset 0 0 0 1px var(--line-strong); transition: background-color 150ms; }
  .power-knob { position: absolute; top: 6px; left: 6px; width: 30px; height: 30px; border-radius: 50%; background: var(--text-2); box-shadow: 0 1px 2px color-mix(in srgb, var(--sidebar) 70%, transparent); transition: transform 300ms var(--ease), background-color 150ms; }
  .power-switch[aria-checked="true"] .power-track { background: var(--primary); }
  .power-switch[aria-checked="true"] .power-knob { transform: translateX(34px); background: var(--on-primary); }
  .power-label { min-width: 11ch; text-align: start; font-size: 14px; font-weight: 600; }
  .power-switch:disabled { opacity: .5; cursor: default; }
  .power-switch:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
  @media (max-width: 1240px) { .twin-power { margin-inline: 24px; padding: 12px 16px; } }
  @media (max-width: 540px) { .twin-power { margin-inline: 16px; gap: 12px; } .power-switch { gap: 8px; } .power-track { width: 64px; height: 38px; } .power-knob { width: 26px; height: 26px; } .power-switch[aria-checked="true"] .power-knob { transform: translateX(26px); } }
  @media (prefers-reduced-motion: reduce) { .power-track, .power-knob { transition: none; } }
</style>
