<script lang="ts">
  import { onMount, tick } from "svelte";
  import { i18n, t } from "../../lib/i18n.svelte";
  import type { TwinStore } from "../../lib/twin.svelte";
  import { LEARNING, learningCards } from "../../lib/twin/learning-stream";
  import { learningCardFrame, settle } from "../../lib/twin/learning-cards";
  import { learningPlayback } from "../../lib/twin/learning-playback";
  import { learningEntrance, type LearningOrigin } from "../../lib/twin/learning-entrance";
  import Icon from "../Icon.svelte";
  import TwinCharacter from "./TwinCharacter.svelte";

  let { twin, origin, onBack }: { twin: TwinStore; origin: LearningOrigin | undefined; onBack: () => void } = $props();
  const snapshot = $derived(twin.snapshot);
  const done = $derived(snapshot?.training.state === "ready");
  let samples = $state<NonNullable<NonNullable<typeof snapshot>["training"]["samples"]>>([]);
  let root: HTMLDivElement;
  let scale = $state(1);
  let frame = $state<number>(LEARNING.start);
  let completionFrame = $state<number>();
  let still = $state(false);
  let paused = $state(false);
  let playback = $state<ReturnType<typeof learningPlayback>>();
  let entranceMotion = $state<ReturnType<typeof learningEntrance>>();
  const cards = $derived(learningCards(frame).map((card) => ({
    id: card.id,
    sample: samples.length ? samples[card.id % samples.length] : undefined,
    pose: done && card.a > frame - (completionFrame ?? 0) ? null : learningCardFrame(frame, card),
  })));
  const cardOpacity = $derived(done ? 1 - settle((completionFrame ?? 0) / 16) : 1);

  $effect(() => {
    const next = snapshot?.training.samples;
    if (next?.length && samples !== next) {
      samples = next;
    }
  });
  $effect(() => { playback?.pause(paused); });
  $effect(() => { playback?.feed(samples.length > 0); });
  $effect(() => { playback?.finish(done); });
  $effect(() => { entranceMotion?.pause(paused || still); });

  onMount(() => {
    const current = learningPlayback(root, (value, stopped, completion) => { frame = value; still = stopped; completionFrame = completion; entranceMotion?.pause(stopped); });
    playback = current;
    let entered = false;
    let disposed = false;
    const resize = new ResizeObserver(([entry]) => {
      if (entry) scale = Math.min(entry.contentRect.width / 1920, entry.contentRect.height / 1080);
      if (!entered) {
        entered = true;
        void tick().then(() => { if (!disposed) entranceMotion = learningEntrance(root, origin); });
      }
    });
    resize.observe(root);
    return () => { disposed = true; current.dispose(); resize.disconnect(); entranceMotion?.destroy(); };
  });
</script>

<div bind:this={root} class="twin-learning" role="region" aria-label={t("Training Twin")} data-testid="twin-learning" data-frame={frame} data-paused={paused || still}>
  <div class="learning-controls">
    <button class="st-btn st-btn--quiet" type="button" aria-pressed={paused} onclick={() => paused = !paused}>
      {paused ? t("Resume motion") : t("Pause motion")}
    </button>
    <button class="st-btn st-btn--quiet" type="button" onclick={onBack}>{t("Back to task")}<Icon name="chevron-right" size={14} /></button>
  </div>
  <div class="learning-film" style={`--film-scale:${scale}`} aria-hidden="true">
    <div class="learning-backlight"></div>
    <div class="learning-floor"></div>
    <h2>{done ? t("Same ideas. Same thoughts.") : t("On sessions from any harness.")}</h2>
    {#each cards as card (card.id)}
      {#if card.sample && card.pose}
        {@const source = snapshot?.sources.find((item) => item.id === card.sample?.sourceId)}
        <article class="learning-card" data-testid="twin-learning-card" data-card-id={card.id} style={`transform:translate(${card.pose.x - 270}px,${card.pose.y - 69}px) scale(${card.pose.scale}) rotateX(0.01deg);opacity:${card.pose.opacity * cardOpacity};filter:blur(${card.pose.blur}px)`}>
          <header>
            <span class="learning-source-mark"><img src={`./twin/logos/${card.sample.sourceId}.${card.sample.sourceId === "opencode" ? "png" : "svg"}`} alt="" /></span>
            <strong>{source?.name ?? card.sample.sourceId}</strong>
          </header>
          <p>{card.sample.quote}</p>
        </article>
      {/if}
    {/each}
    <div class="learning-character"><TwinCharacter state="learning" learningFrame={frame} {completionFrame} motionPaused={paused || still || !samples.length} controls={false} size={430 / 0.78} /></div>
    <div class="learning-progress">
      <div><Icon name={done ? "check" : "spark"} size={20} /><strong>{done ? t("Ready to represent you") : t("Learning…")}</strong>{#if done}<span>100 %</span>{/if}</div>
      <progress aria-label={t("Training Twin")} value={done ? 1 : undefined} max="1"></progress>
      <p>{t("Read {0} sessions and {1} messages", [snapshot?.training.sessions.toLocaleString(i18n.locale) ?? "0", snapshot?.training.messages.toLocaleString(i18n.locale) ?? "0"])}</p>
    </div>
  </div>
  <div class="learning-footer">
    <p class="learning-status" role="status">{done ? t("Ready to represent you") : snapshot?.training.state === "reading" ? t("Reading selected sessions…") : t("Learning from your decisions")}</p>
    {#if !done}<button class="st-btn st-btn--quiet" type="button" disabled={twin.busy} onclick={() => twin.cancel()}>{t("Cancel training")}</button>{/if}
  </div>
  {#if twin.error}<p class="learning-error" role="alert">{twin.error}</p>{/if}
</div>

<style>
  .twin-learning { position: absolute; inset: 0; z-index: 2; overflow: hidden; background: var(--sidebar); isolation: isolate; }
  .learning-film { position: absolute; width: 1920px; height: 1080px; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(var(--film-scale)); transform-origin: center; pointer-events: none; }
  .learning-backlight { position: absolute; inset: 0; background: radial-gradient(70% 60% at 50% 28%, color-mix(in srgb, var(--text) 4.5%, transparent), transparent 70%); }
  .learning-floor { position: absolute; left: 143px; top: 724px; width: 1634px; height: 361px; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--primary) 16%, transparent), color-mix(in srgb, var(--primary) 5.5%, transparent) 45%, transparent); }
  h2 { position: absolute; top: 110px; left: 160px; width: 1600px; margin: 0; text-align: center; font-size: 80px; font-weight: 640; line-height: 1.1; letter-spacing: -0.03em; text-wrap: balance; }
  .learning-card { position: absolute; inset: 0 auto auto 0; width: 540px; height: 138px; padding: 20px 26px 0; border-radius: 18px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-strong), inset 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent), 0 24px 70px rgb(0 0 0 / 55%); }
  .learning-card header { display: flex; align-items: center; gap: 11px; height: 30px; white-space: nowrap; }
  .learning-source-mark { width: 30px; height: 30px; display: grid; place-items: center; flex: none; }
  .learning-source-mark img { width: 30px; height: 30px; object-fit: contain; }
  .learning-card strong { font-size: max(17px, 11px / var(--film-scale)); font-weight: 620; color: var(--text-2); letter-spacing: -0.005em; }
  .learning-card p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; margin: 14px 0 0; font-size: max(25px, 13px / var(--film-scale)); line-height: 1.28; letter-spacing: -0.01em; font-weight: 500; text-wrap: balance; overflow-wrap: anywhere; }
  .learning-character { position: absolute; left: 684.359px; top: 397.821px; width: 551.282px; height: 551.282px; }
  .learning-progress { position: absolute; left: 680px; top: 962px; width: 560px; }
  .learning-progress > div { display: flex; align-items: center; gap: 10px; font-size: max(18px, 12px / var(--film-scale)); color: var(--text-2); }
  .learning-progress strong { font-weight: 500; }
  .learning-progress span { margin-inline-start: auto; color: var(--text); font-weight: 600; }
  progress { display: block; width: 100%; height: 4px; margin-top: 12px; border: 0; border-radius: 2px; overflow: hidden; appearance: none; background: var(--line-strong); accent-color: var(--primary); }
  progress::-webkit-progress-bar { background: var(--line-strong); }
  progress::-webkit-progress-value { background: var(--primary); }
  progress:indeterminate { background: linear-gradient(90deg, transparent, var(--primary), transparent) 0 0 / 40% 100% no-repeat var(--line-strong); animation: learning-pending 1800ms linear infinite; }
  .learning-progress p { margin: 10px 0 0; font-size: max(14px, 11px / var(--film-scale)); color: var(--muted); font-variant-numeric: tabular-nums; }
  .learning-controls { position: absolute; z-index: 1; top: 16px; inset-inline: 20px; display: flex; justify-content: space-between; gap: 12px; }
  .learning-footer { position: absolute; z-index: 1; bottom: 12px; inset-inline: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .learning-status { margin: 0; font-size: 12px; color: var(--text-2); }
  .learning-error { position: absolute; z-index: 1; bottom: 52px; inset-inline: 20px; margin: 0; color: var(--error); font-size: 13px; overflow-wrap: anywhere; }
  [data-paused="true"] progress { animation-play-state: paused; }
  @keyframes learning-pending { from { background-position: -65% 0; } to { background-position: 165% 0; } }
  @media (prefers-reduced-motion: reduce) { progress:indeterminate { animation: none; background-position: 50% 0; } }
</style>
