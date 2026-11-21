<script lang="ts">
  import { untrack } from "svelte";
  import type { TwinStore } from "../../lib/twin.svelte";
  import type { RunStore } from "../../lib/run.svelte";
  import { t } from "../../lib/i18n.svelte";
  import Icon from "../Icon.svelte";
  import TwinSources from "./TwinSources.svelte";
  import TwinProfile from "./TwinProfile.svelte";
  import TwinLearning from "./TwinLearning.svelte";
  import TwinPower from "./TwinPower.svelte";
  import { prefersReducedMotion } from "../../lib/motion";
  import type { LearningOrigin } from "../../lib/twin/learning-entrance";
  import "./twin.css";

  let {
    twin,
    run,
    onClose,
  }: {
    twin: TwinStore;
    run: RunStore;
    onClose: () => void;
  } = $props();
  const project = $derived(run.project);
  const providers = $derived(run.info?.providers ?? []);
  const defaultProvider = $derived(run.provider);
  const defaultModel = $derived(run.info?.model ?? "");
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
  const visibleTrainingError = $derived(
    snapshot?.training.state === "error" && snapshot.training.message !== twin.dismissedError
      ? snapshot.training.message
      : "",
  );
  function selectTab(next: "sources" | "profile"): void {
    if (twin.tab !== next) {
      twin.dismissTransientErrors();
      twin.tab = next;
    }
  }
  function closePanel(): void {
    twin.dismissTransientErrors();
    onClose();
  }
</script>

<div bind:this={page} class="twin-page" data-testid="twin-page">
  {#if learningVisible}
    <div class="twin-learning-layout">
      <TwinPower {twin} />
      <div class="twin-learning-scene"><TwinLearning {twin} {origin} onBack={closePanel} /></div>
    </div>
  {:else}
  <header class="twin-header">
    <div><div class="twin-title"><h1>Twin</h1><span class="twin-state">{snapshot && !twin.enabled ? t("Twin is off") : twin.training ? t("Learning…") : snapshot?.entries.length ? t("Ready to represent you") : t("Not trained")}</span></div><p>{t("Thinks like you. Speaks for you while you work.")} <span>{project}</span></p></div>
    <button class="st-btn st-btn--quiet" type="button" onclick={closePanel}><Icon name="chevron-right" size={14} />{t("Back to task")}</button>
  </header>
  <TwinPower {twin} />
  <div class="twin-toolbar">
    <nav aria-label={t("Twin sections")}>
      <button type="button" aria-pressed={twin.tab === "sources"} onclick={() => selectTab("sources")}>{t("Sources")}</button>
      <button type="button" aria-pressed={twin.tab === "profile"} onclick={() => selectTab("profile")}>{t("Your character")}{#if snapshot?.entries.length}<span>{snapshot.entries.length}</span>{/if}</button>
    </nav>
  </div>
  <div class="twin-content">
    {#if twin.error}<div class="twin-error" role="alert"><p>{twin.error}</p><button class="st-btn st-btn--quiet" type="button" disabled={twin.busy} onclick={() => twin.load()}>{t("Reload")}</button></div>{/if}
    {#if visibleTrainingError}<p class="twin-error" role="alert">{visibleTrainingError}</p>{/if}
    {#if !snapshot}<p class="twin-empty" role="status">{twin.busy ? t("Loading Twin…") : t("Twin is unavailable. Reload to try again.")}</p>
    {:else if twin.tab === "sources"}<TwinSources {twin} {providers} {defaultProvider} {defaultModel} />
    {:else}<TwinProfile {twin} />{/if}
  </div>
  {/if}
</div>

<style>
  .twin-page { position: relative; }
  .twin-learning-layout { display: flex; flex-direction: column; flex: 1; min-height: 0; padding-top: 16px; }
  .twin-learning-scene { position: relative; flex: 1; min-height: 0; }
</style>
