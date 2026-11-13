<script lang="ts">
  import { providerGlyph, providerLogoUrl } from "../lib/provider-glyph";

  interface Props {
    id: string;
    baseUrl?: string | undefined;
    size?: number;
    title?: string | undefined;
  }

  let { id, baseUrl, size = 26, title }: Props = $props();
  const glyph = $derived(providerGlyph(id, baseUrl, title));
  const logoSize = $derived(Math.max(12, Math.round(size * 0.66)));
  const fontSize = $derived(Math.max(9, Math.round(size * 0.36)));
</script>

<span
  class="provider-glyph"
  class:has-logo={glyph.logo !== undefined}
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:--glyph-background={`var(--provider-glyph-${glyph.tone})`}
  title={glyph.label}
  aria-hidden="true"
>
  {#if glyph.logo !== undefined}
    <span
      class="logo"
      style:width={`${logoSize}px`}
      style:height={`${logoSize}px`}
      style:mask-image={`url("${providerLogoUrl(glyph.logo)}")`}
    ></span>
  {:else}
    <span class="monogram" style:font-size={`${fontSize}px`}>{glyph.monogram}</span>
  {/if}
</span>

<style>
  .provider-glyph {
    display: inline-grid;
    place-items: center;
    flex: none;
    border-radius: 7px;
    line-height: 1;
    color: var(--text);
    background: var(--raised);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .provider-glyph:not(.has-logo) {
    color: var(--provider-glyph-foreground);
    background: var(--glyph-background);
  }

  .logo {
    display: block;
    background-color: currentColor;
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
  }

  .monogram {
    font-weight: 700;
    letter-spacing: 0.02em;
  }
</style>
