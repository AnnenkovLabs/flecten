<script lang="ts">
  import { onMount } from "svelte";

  let { stream, processing = false }: { stream: MediaStream | null; processing?: boolean } = $props();
  let root: HTMLDivElement;
  let visible = $state(true);
  let reduced = $state(false);
  let hidden = $state(false);

  onMount(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => { reduced = motion.matches; };
    const updateVisibility = () => { hidden = document.hidden; };
    updateMotion();
    updateVisibility();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; });
    observer.observe(root);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  });

  $effect(() => {
    if (!stream || reduced || hidden || !visible) return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    let last = 0;
    let level = 0;
    function draw(now: number): void {
      frame = requestAnimationFrame(draw);
      if (now - last < 32) return;
      last = now;
      analyser.getFloatTimeDomainData(samples);
      analyser.getByteFrequencyData(spectrum);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      const target = Math.min(1, Math.sqrt(energy / samples.length) * 7);
      level += (target - level) * (target > level ? 0.55 : 0.15);
      root.style.setProperty("--voice-level", String(level));
      for (const [name, low, high] of [["low", 80, 300], ["mid", 300, 2000], ["high", 2000, 6000]] as const) {
        const from = Math.floor(low * analyser.fftSize / context.sampleRate);
        const to = Math.min(spectrum.length, Math.ceil(high * analyser.fftSize / context.sampleRate));
        let total = 0;
        for (let index = from; index < to; index++) total += spectrum[index] ?? 0;
        root.style.setProperty(`--voice-${name}`, String(total / Math.max(1, to - from) / 255));
      }
    }
    void context.resume().catch(() => undefined);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      void context.close();
    };
  });
</script>

<div bind:this={root} class="voice-glow" class:processing class:paused={hidden || !visible}
  aria-hidden="true">
  <div class="voice-bloom"><i></i><i></i><i></i><i></i><i></i></div>
  <div class="voice-ridge"></div>
</div>

<style>
  /* Voice Glow's bottom beam and band-driven lobes, adapted to the shared accent palette. */
  .voice-glow {
    --voice-level: 0;
    --voice-low: 0;
    --voice-mid: 0;
    --voice-high: 0;
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    pointer-events: none;
    z-index: -1;
    mask-image: linear-gradient(transparent, #fff 70%);
  }
  .voice-bloom { position: absolute; inset: auto 24px -32px; height: 70px; filter: blur(14px); }
  i {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 30%;
    height: 64px;
    border-radius: 50%;
    background: var(--primary);
    opacity: calc(0.18 + var(--voice-level) * 0.28);
    transform-origin: center bottom;
    transform: translateX(-50%) scaleY(calc(0.35 + var(--voice-low) * 1.6));
  }
  i:nth-child(2) { left: 28%; background: var(--primary-end); transform: translateX(-50%) scaleY(calc(0.25 + var(--voice-mid) * 1.8)); }
  i:nth-child(3) { left: 72%; background: var(--primary-hover); transform: translateX(-50%) scaleY(calc(0.25 + var(--voice-mid) * 1.8)); }
  i:nth-child(4) { left: 12%; background: var(--text-2); transform: translateX(-50%) scaleY(calc(0.2 + var(--voice-high) * 1.6)); }
  i:nth-child(5) { left: 88%; background: var(--primary-end); transform: translateX(-50%) scaleY(calc(0.2 + var(--voice-high) * 1.6)); }
  .voice-ridge {
    position: absolute;
    inset: auto 24px 0;
    height: 2px;
    opacity: calc(0.35 + var(--voice-level) * 0.65);
    background: linear-gradient(90deg, transparent, var(--primary-end), var(--primary-hover), var(--primary), transparent);
    filter: blur(0.7px);
    transform: scaleX(calc(0.5 + var(--voice-level) * 0.5));
  }
  .processing .voice-bloom, .processing .voice-ridge { animation: voice-sweep 1800ms var(--ease) infinite alternate; }
  .processing i { opacity: 0.3; transform: translateX(-50%) scaleY(0.65); }
  .paused .voice-bloom, .paused .voice-ridge { animation-play-state: paused; }
  @keyframes voice-sweep { from { translate: -20% 0; } to { translate: 20% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .voice-bloom, .voice-ridge { animation: none !important; }
    i { transform: translateX(-50%) scaleY(0.5) !important; opacity: 0.25; }
  }
</style>
