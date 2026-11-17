<script lang="ts">
  import { tooltipLayer } from "../../lib/tooltip";

  const id = $props.id();
</script>

<div {id} class="tooltip-layer" role="tooltip" popover="manual" use:tooltipLayer></div>

<style>
  .tooltip-layer {
    position: fixed;
    inset: auto;
    width: max-content;
    max-width: min(360px, calc(100vw - 16px));
    max-height: min(300px, calc(100vh - 16px));
    margin: 0;
    padding: 7px 10px;
    overflow: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    background: var(--raised);
    color: var(--text);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    user-select: text;
    pointer-events: auto;
  }

  .tooltip-layer::backdrop {
    display: none;
  }

  @media (forced-colors: active) {
    .tooltip-layer {
      border-color: CanvasText;
      background: Canvas;
      color: CanvasText;
    }
  }
</style>
