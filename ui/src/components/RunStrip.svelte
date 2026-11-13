<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { formatDuration } from "../lib/agent";
  import { budgetMeters, budgetTone } from "../lib/run/budget";
  import { stopJob } from "../lib/run/intents";
  import type { AgentBudget, AgentJob } from "../lib/types";
  import Icon from "./Icon.svelte";

  let { jobs, budget }: { jobs: AgentJob[]; budget: AgentBudget | null } = $props();

  const running = $derived(jobs.filter((job) => job.status === "running"));
  const meters = $derived(budget ? budgetMeters(budget) : []);
  const tone = $derived(budget ? budgetTone(budget, meters) : "ok");
  const warningMeters = $derived(meters.filter((meter) => meter.ratio >= 0.8 || meter.kind === budget?.exceeded));
  let now = $state(Date.now());

  $effect(() => {
    if (running.length === 0) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
</script>

{#if running.length > 0 || tone !== "ok"}
  <div class="strip" role="group" aria-label={t("Background commands and run budget")}>
    {#each running as job (job.id)}
      <div class="job" title={`${job.command}\n${job.cwd}`}>
        <span class="job-dot" aria-hidden="true"></span>
        <code class="job-command">{job.command}</code>
        <span class="job-time">{formatDuration(Math.max(0, now - job.startedAt))}</span>
        <button
          class="job-stop"
          type="button"
          aria-label={t("Stop background command {0}", [job.command])}
          title={t("Stop")}
          onclick={() => stopJob(job.id)}
        >
          <Icon name="stop" size={12} />
        </button>
      </div>
    {/each}
    {#if tone !== "ok"}
      <details
        class="budget"
        class:is-warn={tone === "warn"}
        class:is-over={tone === "over"}
      >
        <summary>{tone === "over" ? t("Limit reached") : t("Near limit")}</summary>
        <div class="budget-details">
          {#each warningMeters as meter (meter.kind)}
            <span class="meter">
              <span class="meter-track" aria-hidden="true">
                <span class="meter-fill" style:width={`${Math.round(meter.ratio * 100)}%`}></span>
              </span>
              {meter.label}
            </span>
          {/each}
        </div>
      </details>
    {/if}
  </div>
{/if}

<style>
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
    max-width: var(--content-w);
    margin: 0 auto;
    padding: 6px 28px 0;
  }

  .job,
  .budget {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 32px;
    padding: 0 4px 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-body);
    font-size: 12px;
  }

  .job {
    max-width: 100%;
  }

  .job-dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--success);
    animation: pulse 1.6s var(--ease) infinite;
  }

  .job-command {
    min-width: 0;
    overflow: hidden;
    font-family: var(--mono);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-time {
    flex: none;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .job-stop {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 50%;
    color: var(--muted);
    transition:
      background var(--t-touch) var(--ease),
      color var(--t-touch) var(--ease);
  }

  .job-stop:hover,
  .job-stop:focus-visible {
    background: var(--raised-hover);
    color: var(--text);
  }

  .budget {
    display: block;
    padding-right: 12px;
    color: var(--muted);
  }

  .budget[open] { border-radius: 12px; }
  .budget summary { min-height: 38px; align-content: center; cursor: pointer; }
  .budget-details { display: flex; flex-wrap: wrap; gap: 8px 14px; padding-block: 2px 10px; }

  .budget.is-warn {
    border-color: color-mix(in srgb, var(--warning) 45%, transparent);
    color: var(--warning);
  }

  .budget.is-over {
    border-color: color-mix(in srgb, var(--error) 45%, transparent);
    color: var(--error);
  }

  .meter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .meter-track {
    position: relative;
    width: 28px;
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--line-strong);
  }

  .meter-fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: currentColor;
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .job-dot {
      animation: none;
    }
  }
</style>
