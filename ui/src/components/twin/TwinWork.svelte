<script lang="ts">
  import type { TwinActivity } from "../../../../shared/twin-activity";
  import type { TwinView } from "../../lib/run/twin-view.svelte";
  import { i18n, t } from "../../lib/i18n.svelte";
  import Icon from "../Icon.svelte";
  import TwinCharacter from "./TwinCharacter.svelte";
  let { view }: { view: TwinView } = $props();
  const latest = $derived(view.latest);
  function state(activity: TwinActivity): string {
    switch (activity.state) {
      case "disabled": return t("Twin paused");
      case "running": return activity.phase === "question" ? t("Twin is checking your standards") : t("Twin is checking your standards");
      case "pass": return activity.phase === "final" ? t("Twin accepted the result") : t("Ready to represent you");
      case "revise": return activity.phase === "prepare" ? t("Ready to represent you") : t("Twin asked for a revision");
      case "ask_user": return t("Twin needs your decision");
      case "exhausted": return activity.corrections >= 4 ? t("Twin could not confirm the result") : t("Twin could not confirm the result");
      case "cancelled": return t("Twin paused");
      case "error": return t("Twin could not confirm the result");
    }
  }
  function phase(activity: TwinActivity): string {
    switch (activity.phase) {
      case "prepare": return t("Before work");
      case "checkpoint": return t("At a checkpoint");
      case "final": return t("Before delivery");
      case "question": return t("Answer to Worker");
    }
  }
</script>

{#if latest}
  <details class="twin-work" data-testid="twin-work" data-state={latest.state}>
    <summary><div class="work-character"><TwinCharacter state={latest.state === "running" ? "learning" : "answer"} emotion={latest.emotion} size={64} /></div><div class="work-label"><span><strong>Twin</strong><span class="work-status" role="status">{state(latest)}</span></span><p>{latest.voice || latest.instructions || t("Representing your intent to the Worker")}</p></div><span class="work-round">{t("Corrections: {0} / 4", [latest.corrections])}</span><Icon name="chevron-down" size={16} /></summary>
    <div class="work-dialogue" aria-label={t("Twin and Worker conversation")}>
      {#each view.items as activity, index (index)}
        <article><header><strong>{phase(activity)}</strong><span>{state(activity)}</span></header>{#if activity.voice}<blockquote>{activity.voice}</blockquote>{/if}{#if activity.instructions}<details><summary>{t("Instructions to Worker")}</summary><p>{activity.instructions}</p></details>{/if}{#if activity.usage}<p class="work-meta">{activity.provider} / {activity.model} · {t("Input: {0} tokens · Output: {1} tokens", [activity.usage.input.toLocaleString(i18n.locale), activity.usage.output.toLocaleString(i18n.locale)])}</p>{/if}</article>
      {/each}
    </div>
  </details>
{/if}

<style>
  .twin-work { flex: none; color: var(--text); border-bottom: 1px solid var(--line); background: var(--surface); }
  .twin-work > summary { display: flex; gap: var(--space-3); align-items: center; min-height: 66px; padding: 4px 28px 4px 16px; cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  .work-character { width: 52px; height: 56px; flex: none; display: grid; place-items: center; }
  .work-label { min-width: 0; flex: 1; }
  .work-label > span { display: flex; align-items: baseline; gap: var(--space-3); flex-wrap: wrap; font-size: 13px; }
  .work-label strong { font-weight: 600; }
  .work-status, .work-round { font-size: 12px; color: var(--text-2); }
  .work-round { flex: none; }
  .work-label p { margin: 4px 0 0; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .work-dialogue { max-height: 40vh; overflow: auto; padding: 0 28px 12px 80px; }
  article { padding: 16px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
  article header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--text-2); font-size: 12px; }
  article strong { font-weight: 500; }
  blockquote { margin: 12px 0; padding: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
  article details { font-size: 12px; color: var(--text-2); }
  article summary { cursor: pointer; min-height: 32px; }
  article details p { white-space: pre-wrap; line-height: 1.6; margin: 8px 0; }
  .work-meta { margin: 12px 0 0; font-size: 11px; color: var(--muted); }
  summary:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
  @media (max-width: 700px) { .work-round { display: none; } .twin-work > summary { padding-inline: 8px 16px; gap: 8px; } .work-dialogue { padding-inline: 16px; } article header { flex-wrap: wrap; } }
</style>
