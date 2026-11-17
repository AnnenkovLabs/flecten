<script lang="ts">
  import { untrack } from "svelte";
  import type { TwinStore } from "../../lib/twin.svelte";
  import { i18n, t } from "../../lib/i18n.svelte";
  import Icon from "../Icon.svelte";
  import TwinSources from "./TwinSources.svelte";
  import TwinProfile from "./TwinProfile.svelte";
  import TwinAsk from "./TwinAsk.svelte";
  import TwinLearning from "./TwinLearning.svelte";
  import TwinPower from "./TwinPower.svelte";
  import { prefersReducedMotion } from "../../lib/motion";
  import type { LearningOrigin } from "../../lib/twin/learning-entrance";
  import "./twin.css";

  let { twin, project, onClose }: { twin: TwinStore; project: string; onClose: () => void } = $props();
  const snapshot = $derived(twin.snapshot);
  let learningVisible = $state(false);
  let page: HTMLDivElement;
  let origin = $state<LearningOrigin>();
  $effect(() => {
    if (twin.training) {
      if (!learningVisible) {
        const stage = page.querySelector(".twin-stage");
        const character = stage?.querySelector(".twin-character");
        origin = stage && character ? { stage: stage.getBoundingClientRect(), character: character.getBoundingClientRect() } : undefined;
      }
      learningVisible = true;
      return;
    }
    if (!learningVisible) return;
    if (snapshot?.training.state === "ready") {
      const timer = setTimeout(() => { learningVisible = false; }, prefersReducedMotion() ? 0 : 900);
      return () => clearTimeout(timer);
    }
    learningVisible = false;
  });
  $effect(() => { twin.projectEpoch; untrack(() => { void twin.load(); }); });
</script>

<div bind:this={page} class="twin-page" data-testid="twin-page">
  {#if learningVisible}
    <div class="twin-learning-layout">
      <TwinPower {twin} />
      <div class="twin-learning-scene"><TwinLearning {twin} {origin} onBack={onClose} /></div>
    </div>
  {:else}
  <header class="twin-header">
    <div><div class="twin-title"><h1>Twin</h1><span class="twin-state">{snapshot && !twin.enabled ? t("Twin is off") : twin.training ? t("Learning…") : snapshot?.entries.length ? t("Ready to represent you") : t("Not trained")}</span></div><p>{t("Thinks like you. Speaks for you while you work.")} <span>{project}</span></p></div>
    <button class="st-btn st-btn--quiet" type="button" onclick={onClose}><Icon name="chevron-right" size={14} />{t("Back to task")}</button>
  </header>
  <TwinPower {twin} />
  <div class="twin-toolbar">
    <nav aria-label={t("Twin sections")}>
      <button type="button" aria-pressed={twin.tab === "sources"} onclick={() => twin.tab = "sources"}>{t("Sources")}</button>
      <button type="button" aria-pressed={twin.tab === "profile"} onclick={() => twin.tab = "profile"}>{t("Your character")}{#if snapshot?.entries.length}<span>{snapshot.entries.length}</span>{/if}</button>
      <button type="button" aria-pressed={twin.tab === "ask"} onclick={() => twin.tab = "ask"}>{t("Ask Twin")}</button>
    </nav>
  </div>
  <div class="twin-content">
    {#if twin.error}<div class="twin-error" role="alert"><p>{twin.error}</p><button class="st-btn st-btn--quiet" type="button" disabled={twin.busy} onclick={() => twin.load()}>{t("Reload")}</button></div>{/if}
    {#if snapshot?.training.state === "error"}<p class="twin-error" role="alert">{snapshot.training.message}</p>{/if}
    {#if !snapshot}<p class="twin-empty" role="status">{twin.busy ? t("Loading Twin…") : t("Twin is unavailable. Reload to try again.")}</p>
    {:else if twin.tab === "sources"}<TwinSources {twin} />
    {:else if twin.tab === "profile"}<TwinProfile {twin} />
    {:else}<TwinAsk {twin} />{/if}
    {#if snapshot && snapshot.training.usage.input + snapshot.training.usage.output > 0}<details class="twin-usage"><summary>{t("Training usage")}</summary><p>{t("Input: {0} tokens · Output: {1} tokens", [snapshot.training.usage.input.toLocaleString(i18n.locale), snapshot.training.usage.output.toLocaleString(i18n.locale)])}</p>{#if snapshot.training.usage.costUsd !== undefined}<p>{new Intl.NumberFormat(i18n.locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(snapshot.training.usage.costUsd)}</p>{/if}</details>{/if}
  </div>
  {/if}
</div>

<style>
  .twin-page { position: relative; }
  .twin-learning-layout { display: flex; flex-direction: column; flex: 1; min-height: 0; padding-top: 16px; }
  .twin-learning-scene { position: relative; flex: 1; min-height: 0; }
</style>
