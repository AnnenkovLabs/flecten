<script lang="ts">
  import type { MarketplaceEntry } from "../../../../shared/module-marketplace";
  import Icon from "../Icon.svelte";
  let { entry }: { entry: MarketplaceEntry } = $props();
  const kind = $derived(entry.source === "bundled" ? entry.name : "community");
</script>

<div class="product-preview" aria-hidden="true">
  {#if kind === "better-trailer"}
    <div class="timeline-cover">
      <div class="preview-label"><Icon name="image" size={16} /><span>Trailer timeline</span><span>00:12</span></div>
      <div class="filmstrip">{#each [1, 2, 3, 4] as frame}<span><Icon name="image" size={24} /><small>0{frame}</small></span>{/each}</div>
      <div class="track"><span></span><span></span><span></span><span></span><i></i></div>
      <div class="frame-ticks"><span>0</span><span>72</span><span>144</span><span>216</span><span>288</span></div>
      <div class="preview-footer"><span>24 fps</span><strong>288 frames</strong></div>
    </div>
  {:else if kind === "studio-harness"}
    <div class="studio-cover"><div class="studio-bar"><Icon name="mark" size={13} /><strong>Studio</strong><span>Project brief</span></div><div class="studio-body"><div class="studio-rail"><span></span><span></span><span></span></div><div class="studio-main"><strong>Your workspace,<br />your way.</strong><div class="mini-copy"></div><div class="mini-copy short"></div><div class="mini-composer"><span></span><Icon name="arrow-up" size={10} /></div></div><div class="studio-brief"><span></span><span></span><span></span><div></div></div></div></div>
  {:else if kind === "frame-workflow"}
    <div class="workflow-cover"><div class="preview-label"><Icon name="tasks" size={16} /><span>Frame workflow</span></div><div class="workflow-steps"><span><Icon name="file" size={22} /></span><i></i><span><Icon name="layers" size={22} /></span><i></i><span><Icon name="check" size={22} /></span></div><div class="workflow-output"><span>trailer-brief.json</span><strong>12s → 288 frames</strong></div></div>
  {:else if kind === "frame-service"}
    <div class="frames-cover"><span class="preview-label">Frame service</span><div class="frame-number"><strong>288</strong><span>frames</span></div><div class="frame-equation"><span>12 seconds</span><span>×</span><span>24 fps</span></div></div>
  {:else if kind === "sqlite-journal"}
    <div class="database-cover"><div class="preview-label"><Icon name="server" size={16} /><span>SQLite journal</span></div><div class="database-body"><svg viewBox="0 0 70 82"><ellipse cx="35" cy="15" rx="27" ry="10" /><path d="M8 15v48c0 6 12 11 27 11s27-5 27-11V15M8 31c0 6 12 11 27 11s27-5 27-11M8 47c0 6 12 11 27 11s27-5 27-11" /></svg><div><span>sessions</span><span>events</span><span>recovery</span></div></div><div class="preview-footer"><span>Local storage</span><Icon name="check" size={14} /></div></div>
  {:else}
    <div class="community-cover"><Icon name={entry.category === "workflow" ? "tasks" : entry.category === "interface" ? "panel-left" : "layers"} size={48} /><strong>{entry.title}</strong><span>{entry.publisher}</span></div>
  {/if}
</div>

<style>
  .product-preview { aspect-ratio: 4 / 3; display: grid; align-items: center; padding: var(--space-5); overflow: hidden; background: var(--surface); color: var(--text-2); border-radius: 10px; container-type: inline-size; }
  .preview-label, .preview-footer { display: flex; align-items: center; gap: var(--space-2); font-size: 11px; }
  .preview-label span:last-child:not(:first-child) { margin-inline-start: auto; }
  .preview-footer { justify-content: space-between; margin-top: var(--space-3); padding-inline-end: var(--space-10); color: var(--muted); }
  .preview-footer strong { font-weight: 500; color: var(--text-2); }
  .timeline-cover, .workflow-cover, .database-cover { width: 100%; min-width: 0; }
  .filmstrip { display: flex; gap: var(--space-1); margin-top: var(--space-4); }
  .filmstrip > span { flex: 1; min-width: 0; aspect-ratio: 1.3; display: grid; place-items: center; position: relative; background: var(--raised); border-radius: 4px; color: var(--muted); }
  .filmstrip small { position: absolute; inset-block-end: 3px; inset-inline-end: 4px; font-size: 8px; }
  .track { display: flex; gap: 3px; position: relative; height: 12px; margin-top: var(--space-2); }
  .track span { flex: 1; background: var(--primary); opacity: 0.45; border-radius: 2px; }
  .track span:nth-child(even) { opacity: 0.75; }
  .track i { position: absolute; inset-inline-start: 64%; inset-block: -64px -23px; width: 1px; background: var(--text); }
  .frame-ticks { display: flex; justify-content: space-between; margin-top: var(--space-2); color: var(--muted); font-size: 8px; }
  .studio-cover { margin: 0 calc(-1 * var(--space-2)); border-radius: 6px; background: var(--bg); overflow: hidden; box-shadow: 0 0 0 1px var(--line-strong); }
  .studio-bar { display: flex; gap: 6px; align-items: center; padding: var(--space-2); border-bottom: 1px solid var(--line); font-size: 9px; }
  .studio-bar > span { margin-inline-start: auto; color: var(--muted); font-size: 7px; }
  .studio-body { display: grid; grid-template-columns: 35px minmax(0, 1fr) 45px; min-height: 135px; }
  .studio-rail, .studio-brief { padding: var(--space-2) var(--space-1); background: var(--sidebar); }
  .studio-rail span, .studio-brief span { display: block; height: 3px; background: var(--line-strong); margin-bottom: 6px; border-radius: 2px; }
  .studio-rail span:first-child { height: 10px; background: var(--raised); }
  .studio-main { display: flex; flex-direction: column; padding: var(--space-3) var(--space-2) var(--space-2); min-width: 0; }
  .studio-main > strong { font-weight: 500; font-size: 12px; line-height: 1.3; letter-spacing: -0.03em; }
  .mini-copy { height: 3px; margin-top: 8px; background: var(--line-strong); }
  .mini-copy.short { width: 70%; margin-top: 4px; }
  .mini-composer { margin-top: auto; height: 22px; border-radius: 5px; background: var(--raised); display: flex; align-items: center; justify-content: end; padding: 5px; }
  .mini-composer :global(svg) { background: var(--primary); color: var(--on-primary); border-radius: 3px; }
  .studio-brief div { height: 55px; margin-top: 12px; background: var(--surface); border-radius: 3px; }
  .workflow-steps { display: flex; align-items: center; margin: var(--space-6) 0 var(--space-5); }
  .workflow-steps > span { display: grid; place-items: center; flex: 0 0 42px; height: 42px; border-radius: 10px; background: var(--raised); }
  .workflow-steps > span:last-child { color: var(--primary); }
  .workflow-steps i { height: 1px; background: var(--line-strong); flex: 1; }
  .workflow-output { display: grid; gap: var(--space-2); }
  .workflow-output span { font-size: 10px; color: var(--muted); }
  .workflow-output strong { font-size: 16px; font-weight: 500; }
  .frames-cover { display: grid; justify-items: center; gap: var(--space-3); }
  .frames-cover > .preview-label { color: var(--muted); }
  .frame-number { display: flex; align-items: baseline; gap: var(--space-2); }
  .frame-number strong { color: var(--text); font-size: clamp(40px, 28cqi, 72px); line-height: 1; font-weight: 500; letter-spacing: -0.06em; }
  .frame-number > span { font-size: 12px; color: var(--muted); }
  .frame-equation { display: flex; gap: var(--space-2); font-size: 11px; }
  .database-body { display: flex; align-items: center; gap: var(--space-5); margin-top: var(--space-3); }
  .database-body > svg { width: 70px; height: 82px; fill: var(--raised); stroke: var(--text-2); stroke-width: 1.3; flex-shrink: 0; }
  .database-body > div { display: grid; gap: var(--space-2); font-size: 11px; color: var(--muted); }
  .community-cover { display: grid; justify-items: center; text-align: center; gap: var(--space-3); overflow-wrap: anywhere; }
  .community-cover strong { font-size: 15px; font-weight: 500; }.community-cover span { font-size: 12px; color: var(--muted); }
</style>
