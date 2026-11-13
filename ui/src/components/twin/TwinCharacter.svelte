<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "../../lib/i18n.svelte";
  import { createTwinScene } from "../../lib/twin/scene";
  let { state: characterState = "idle", emotion = "calm", compact = false, size = 448 }: {
    state?: "idle" | "learning" | "ready" | "answer";
    emotion?: "calm" | "pleased" | "angry" | "furious";
    compact?: boolean;
    size?: number;
  } = $props();
  const pose = $derived(emotion === "angry" || emotion === "furious" ? emotion : characterState);
  const interactive = $derived(!compact && size >= 112);
  let canvas: HTMLCanvasElement;
  let scene = $state<ReturnType<typeof createTwinScene>>();
  let fallback = $state(true);
  let paused = $state(false);
  onMount(() => {
    const current = createTwinScene(canvas, interactive, (shown) => { fallback = shown; });
    scene = current;
    return () => current.dispose();
  });
  $effect(() => { scene?.set(characterState, emotion); });
  $effect(() => { scene?.pause(paused); });
</script>

<span class="twin-character" class:compact aria-hidden={compact || undefined} data-testid="twin-character" style={`--twin-size:${size}px`}>
  <canvas bind:this={canvas} class:fallback aria-label={t("Your Twin")} width="64" height="64"></canvas>
  {#if fallback}<img src={`./twin/${pose}.webp`} alt={t("Your Twin")} width="640" height="640" draggable="false" />{/if}
  {#if interactive}
    <button type="button" class="character-input" aria-label={t("Interact with Twin")} title={t("Drag to turn. Move to look. Click to greet. Arrow keys turn; Home resets.")}
      onpointermove={(event) => scene?.point(event)} onpointerdown={(event) => scene?.down(event)} onpointerup={(event) => scene?.up(event)}
      onpointerleave={() => scene?.leave()} onpointercancel={() => scene?.cancel()} onlostpointercapture={() => scene?.cancel()} onkeydown={(event) => scene?.key(event)}></button>
    <button type="button" class="character-pause" aria-pressed={paused} onclick={() => paused = !paused}>{paused ? t("Resume motion") : t("Pause motion")}</button>
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
  button.character-input:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
  .character-pause { position: absolute; right: 0; top: 0; min-height: 32px; padding: 4px 8px; font-size: 11px; color: var(--text-2); border-radius: 6px; background: var(--surface); opacity: 0; transition: opacity 150ms; }
  .twin-character:hover .character-pause, .twin-character:focus-within .character-pause, .character-pause[aria-pressed="true"] { opacity: 1; }
  @media (pointer: coarse) { .character-pause { opacity: 1; min-height: 44px; } }
  @media (prefers-reduced-motion: reduce) { .character-pause { transition: none; } }
</style>
