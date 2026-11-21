<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { createTwinBlobRenderer } from "../../lib/twin/blob-renderer";

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();
  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let fallback = $state(false);

  const FUR_bleed_PX = 16;
  const RADIUS_PX = 16;

  onMount(() => {
    let renderer: ReturnType<typeof createTwinBlobRenderer> | null = null;
    try {
      renderer = createTwinBlobRenderer(canvas);
    } catch {
      fallback = true;
      return;
    }

    let width = 320;
    let height = 72;
    let raf = 0;
    const started = performance.now();
    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

    const draw = (now: number) => {
      if (!renderer) return;
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const bleed = FUR_bleed_PX * dpr;
      const boxW = Math.max(24, width * dpr);
      const boxH = Math.max(24, height * dpr);
      renderer.render({
        width: boxW + bleed * 2,
        height: boxH + bleed * 2,
        boxWidth: boxW,
        boxHeight: boxH,
        radiusPx: RADIUS_PX * dpr,
        furPx: FUR_bleed_PX * 0.9 * dpr,
        time: reduceMotion ? 0 : (now - started) / 1000,
      });
      if (!reduceMotion) {
        raf = requestAnimationFrame(draw);
      }
    };

    const measure = () => {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      width = Math.max(48, rect.width);
      height = Math.max(36, rect.height);
      draw(performance.now());
    };

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    if (!reduceMotion) {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer?.dispose();
    };
  });
</script>

<div class="twin-blob" class:is-fallback={fallback} bind:this={container} data-testid="twin-blob">
  <canvas
    bind:this={canvas}
    class="twin-blob-canvas"
    class:is-hidden={fallback}
    aria-hidden="true"
    data-testid="twin-blob-canvas"
  ></canvas>
  <div class="twin-blob-inner">
    {@render children?.()}
  </div>
</div>

<style>
  .twin-blob {
    position: relative;
    display: inline-block;
    max-width: 100%;
    border-radius: 16px;
    padding: 14px 18px;
    margin: 12px 12px 6px;
    isolation: isolate;
  }

  .twin-blob.is-fallback {
    background: linear-gradient(145deg, rgba(64, 48, 102, 0.88), rgba(32, 24, 54, 0.94));
    box-shadow:
      0 0 0 1.5px rgba(206, 184, 252, 0.35),
      0 10px 28px rgba(18, 12, 34, 0.45);
  }

  .twin-blob-canvas {
    position: absolute;
    inset: -16px;
    width: calc(100% + 32px);
    height: calc(100% + 32px);
    pointer-events: none;
    z-index: 0;
  }

  .twin-blob-canvas.is-hidden {
    display: none;
  }

  .twin-blob-inner {
    position: relative;
    z-index: 1;
    color: rgba(247, 244, 255, 0.98);
    text-shadow: 0 1px 2px rgba(10, 7, 20, 0.55);
  }
</style>
