<script lang="ts">
  import { isBusy, phaseLabel, type Phase } from "../lib/run-machine";

  interface Props {
    phase: Phase;
  }

  let { phase }: Props = $props();

  const label = $derived(phaseLabel(phase));
  const running = $derived(isBusy(phase));
  const stopped = $derived(phase === "stopped");
  const failed = $derived(phase === "failed");
</script>

<span
  class="state"
  class:is-running={running}
  class:is-stopped={stopped}
  class:is-failed={failed}
  class:is-done={phase === "idle"}
  aria-live="polite"
>
  <span class="state-dot" aria-hidden="true"></span>
  <span class="state-label">{label}</span>
</span>

<style>
  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: 12px;
    white-space: nowrap;
  }

  .state.is-done {
    color: var(--success);
  }

  .state.is-stopped {
    color: var(--warning);
  }

  .state.is-failed {
    color: var(--error);
  }

  .state-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
    transition:
      background 700ms var(--ease),
      border-radius 900ms var(--ease-jelly);
  }

  .state.is-running .state-dot {
    background: var(--primary);
    animation:
      state-pulse 3.2s ease-in-out infinite,
      state-morph 4.4s var(--ease-jelly) infinite;
  }

  .state.is-stopped .state-dot {
    background: var(--warning);
  }

  .state.is-failed .state-dot {
    background: var(--error);
  }

  .state-label {
    display: inline-block;
  }

  @keyframes state-pulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes state-morph {
    0%,
    100% {
      border-radius: 50%;
      transform: scale(1);
    }
    38% {
      border-radius: 62% 38% 54% 46%;
      transform: scale(1.18);
    }
    68% {
      border-radius: 44% 56% 40% 60%;
      transform: scale(0.92);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .state-dot {
      animation: none;
    }
  }
</style>
