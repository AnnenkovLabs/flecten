<script lang="ts">
  let { value, min, max, initial, label, horizontal = false, reverse = false, onChange, edge = "end" }: { value: number; min: number; max: number; initial: number; label: string; horizontal?: boolean; reverse?: boolean; edge?: "start" | "end"; onChange: (value: number) => void } = $props();
  let dragging = $state(false);
  let start = 0;
  let size = 0;
  const update = (next: number): void => onChange(Math.round(Math.max(min, Math.min(max, next))));
</script>
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (APG window splitters are focusable separators with keyboard resizing.) -->
<div class="resize" class:horizontal class:start={edge === "start"} class:dragging role="separator" tabindex="0" aria-label={label} aria-orientation={horizontal ? "horizontal" : "vertical"} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}
  onpointerdown={(event) => { if (event.button !== 0) return; event.preventDefault(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); start = horizontal ? event.clientY : event.clientX; size = value; dragging = true; }}
  onpointermove={(event) => { if (dragging) update(size + ((horizontal ? event.clientY : event.clientX) - start) * (reverse ? -1 : 1)); }}
  onpointerup={() => dragging = false} onlostpointercapture={() => dragging = false} ondblclick={() => update(initial)}
  onkeydown={(event) => { const negative = horizontal ? "ArrowUp" : "ArrowLeft"; const positive = horizontal ? "ArrowDown" : "ArrowRight"; if (event.key === negative || event.key === positive) { event.preventDefault(); update(value + (event.key === positive ? 16 : -16) * (reverse ? -1 : 1)); } else if (event.key === "Home") { event.preventDefault(); update(initial); } }}></div>
<style>
  .resize { position: absolute; inset-block: 0; inset-inline-end: -4px; width: 8px; z-index: 10; cursor: col-resize; touch-action: none; padding: 0; background: transparent; border-radius: 0; } .resize.start { inset-inline-start: -4px; inset-inline-end: auto; } .resize::after { content: ""; position: absolute; inset-block: 0; inset-inline-start: 3px; width: 2px; background: transparent; } .resize:hover::after, .resize.dragging::after { background: var(--primary); } .resize.horizontal { inset: -4px 0 auto; width: auto; height: 8px; cursor: row-resize; } .resize.horizontal::after { inset: 3px 0 auto; height: 2px; width: auto; } .resize:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
</style>
