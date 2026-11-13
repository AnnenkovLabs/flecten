<script lang="ts">
  import { retryStatus } from "../lib/retry-status.svelte";
  import { retryMeta } from "../lib/run-errors";
  import LiveGlow from "./LiveGlow.svelte";

  interface Props {
    label: string;
    glow?: boolean;
  }

  let { label, glow = true }: Props = $props();
  let now = $state(Date.now());

  // A request waiting for its retry shows a live countdown instead of a frozen number.
  $effect(() => {
    if (retryStatus.until === 0) return;
    now = Date.now();
    const timer = setInterval(() => {
      now = Date.now();
    }, 1_000);
    return () => clearInterval(timer);
  });

  const countdown = $derived(retryStatus.until > 0 ? retryMeta(retryStatus.until, now) : "");
</script>

<div class="live-run">
  {#if glow}
    <LiveGlow />
  {/if}
  <span class="live-dot-wrap" aria-hidden="true">
    <span class="live-dot"></span>
    <span class="live-dot-satellite"></span>
  </span>
  <span>{label}</span>
  {#if countdown}
    <span class="live-meta">{countdown}</span>
  {/if}
</div>

<style>
  .live-run {
    position: relative;
    isolation: isolate;
    display: flex;
    align-items: center;
    gap: 10px;
    width: fit-content;
    max-width: 100%;
    margin-top: 12px;
    color: var(--text-2);
    font-size: 13.5px;
    animation: live-in 180ms var(--ease) both;
  }

  @keyframes live-in {
    from { opacity: 0; transform: translateY(3px); }
    to { opacity: 1; transform: none; }
  }

  .live-dot-wrap {
    position: relative;
    display: block;
    width: 13px;
    height: 13px;
    flex: none;
    filter: url(#goo-tight);
  }

  .live-dot,
  .live-dot-satellite {
    position: absolute;
    top: 50%;
    left: 50%;
    border-radius: 50%;
    background: var(--primary);
    translate: -50% -50%;
  }

  .live-dot {
    width: 7px;
    height: 7px;
    animation: live-pulse 3.2s ease-in-out infinite;
  }

  .live-dot-satellite {
    width: 5px;
    height: 5px;
    opacity: 0.9;
    animation: live-orbit 3.6s var(--ease-jelly) infinite;
  }

  @keyframes live-orbit {
    0%,
    100% {
      transform: translate(0, 0) scale(0.8);
    }
    35% {
      transform: translate(4px, -2px) scale(1.35);
    }
    68% {
      transform: translate(-3px, 2px) scale(0.9);
    }
  }

  .live-meta {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes live-pulse {
    0%,
    100% {
      opacity: 0.4;
      transform: scale(0.92);
    }
    50% {
      opacity: 1;
      transform: scale(1.12);
    }
  }
</style>
