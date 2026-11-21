<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { t } from "../../lib/i18n.svelte";
  import { createTwinScene } from "../../lib/twin/scene";
  import { twinPowerContext, type TwinPowerSource } from "../../lib/twin/context";
  import type { TwinPowerVisual } from "../../lib/twin/power";
  let { state: characterState = "idle", emotion = "calm", compact = false, size = 448, learningFrame, completionFrame, motionPaused = false, controls = true }: {
    state?: "idle" | "learning" | "ready" | "answer";
    emotion?: "calm" | "pleased" | "angry" | "furious";
    compact?: boolean;
    size?: number;
    learningFrame?: number;
    completionFrame?: number | undefined;
    motionPaused?: boolean;
    controls?: boolean;
  } = $props();
  const pose = $derived(emotion === "angry" || emotion === "furious" ? emotion : characterState);
  const interactive = $derived(!compact && size >= 112);
  const powerSource = getContext<TwinPowerSource | undefined>(twinPowerContext);
  const power = $derived<TwinPowerVisual>(powerSource?.() ?? { phase: "enabled", since: 0 });
  const locked = $derived(power.phase !== "enabled");
  const fallbackPose = $derived(power.phase === "enabled" ? pose : power.phase === "falling" ? "disabled" : power.phase);
  let canvas: HTMLCanvasElement;
  let scene = $state<ReturnType<typeof createTwinScene>>();
  let fallback = $state(true);
  onMount(() => {
    const current = createTwinScene(canvas, interactive, (shown) => { fallback = shown; });
    scene = current;
    return () => current.dispose();
  });
  $effect(() => { scene?.set(characterState, emotion, learningFrame, completionFrame); });
  $effect(() => { scene?.power(power); });
  $effect(() => { scene?.pause(motionPaused); });
</script>

<span class="twin-character" class:compact aria-hidden={compact || undefined} data-testid="twin-character" data-power={power.phase} style={`--twin-size:${size}px`}>
  <canvas bind:this={canvas} class:fallback aria-label={t("Your Twin")} width="64" height="64"></canvas>
  {#if fallback}<img src={`./twin/${fallbackPose}.webp`} alt={t("Your Twin")} width="640" height="640" draggable="false" />{/if}
  {#if interactive && controls}
    <button type="button" class="character-input" disabled={locked} aria-label={t("Interact with Twin")}
      onpointermove={(event) => scene?.point(event)} onpointerdown={(event) => scene?.down(event)} onpointerup={(event) => scene?.up(event)}
      onpointerleave={() => scene?.leave()} onpointercancel={() => scene?.cancel()} onlostpointercapture={() => scene?.cancel()} onkeydown={(event) => scene?.key(event)}></button>
  {/if}
</span>

<style>
  .twin-character { position: relative; display: block; flex: none; width: min(100%, var(--twin-size)); aspect-ratio: 1; }
  canvas, img { display: block; width: 100%; height: 100%; object-fit: contain; user-select: none; pointer-events: none; }
  canvas.fallback { visibility: hidden; }
  img { position: absolute; inset: 0; }
  .compact { width: 24px; height: 24px; }
  button.character-input { position: absolute; inset: 8% 8% 5%; border: 0; border-radius: 12px; background: transparent; touch-action: none; cursor: grab; }
  button.character-input:active { cursor: grabbing; scale: 1; }
  button.character-input:disabled { cursor: default; }
  button.character-input:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
</style>
