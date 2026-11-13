<script lang="ts">
  import type { FileKind } from "../lib/types";

  let { kind, size = 16 }: { kind: FileKind; size?: number } = $props();

  const label = $derived(
    kind === "test" ? "TS" : kind === "other" ? "·" : kind.toUpperCase(),
  );
</script>

<span class="ft {kind}" aria-hidden="true" style:width={`${size}px`} style:height={`${size}px`}>
  {label}
</span>

<style>
  .ft {
    display: grid;
    place-items: center;
    flex: none;
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .ft.ts,
  .ft.test {
    background: rgba(122, 162, 247, 0.16);
    color: #8fb2f5;
  }

  .ft.test {
    background: rgba(158, 206, 106, 0.14);
    color: #aacb80;
  }

  .ft.js {
    background: rgba(211, 189, 145, 0.14);
    color: var(--warning);
  }

  .ft.css {
    background: rgba(146, 131, 196, 0.16);
    color: #b9a9e8;
  }

  .ft.json {
    background: rgba(240, 239, 237, 0.08);
    color: var(--text-2);
  }

  .ft.md,
  .ft.py,
  .ft.rs,
  .ft.other {
    background: rgba(240, 239, 237, 0.06);
    color: var(--muted);
  }
</style>
