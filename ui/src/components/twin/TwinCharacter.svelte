<script lang="ts">
  let { state = "idle", emotion = "calm", compact = false, size = 448 }: {
    state?: "idle" | "learning" | "ready" | "answer";
    emotion?: "calm" | "pleased" | "angry" | "furious";
    compact?: boolean;
    size?: number;
  } = $props();
  const pose = $derived(emotion === "angry" || emotion === "furious" ? emotion : state);
</script>

<img class:compact src={`./twin/${pose}.webp`} alt="" width="640" height="640" style={`--twin-size:${size}px`} draggable="false" />

<style>
  img { display: block; width: min(100%, var(--twin-size)); height: auto; object-fit: contain; user-select: none; pointer-events: none; }
  img.compact { width: 24px; height: 24px; }
</style>
