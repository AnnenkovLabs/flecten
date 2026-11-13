<script lang="ts">
  let { variant = 0, size = 28 }: { variant?: number; size?: number } = $props();
  const uid = $props.id();
  const shapes = [
    "M9 25C6 15 13 7 23 8C33 4 42 13 40 23C46 34 36 42 26 39C14 43 5 36 9 25Z",
    "M13 10Q24 3 35 10Q44 18 39 33Q32 43 18 39Q5 36 8 23Q7 15 13 10Z",
    "M24 6Q28 6 31 13L39 17Q44 20 39 27L37 36Q35 42 27 38L19 39Q11 41 10 33L7 24Q4 18 13 15L19 9Q22 6 24 6Z",
    "M13 8H32Q40 8 40 17V31Q40 40 31 40H17Q8 40 8 31V17Q8 8 13 8Z",
    "M24 7Q35 7 39 20Q45 32 34 38Q24 43 13 37Q3 31 10 20Q15 7 24 7Z",
    "M11 13Q18 6 25 11Q34 5 39 15Q43 23 37 28Q42 38 31 40Q23 43 18 37Q8 42 7 31Q4 21 11 13Z",
  ];
  const shape = $derived(shapes[variant % shapes.length] ?? shapes[0]);
</script>

<svg class="subagent-avatar" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-avatar={variant}
  style={`--avatar-light: var(--subagent-${variant}-light); --avatar-body: var(--subagent-${variant}-body); --avatar-shade: var(--subagent-${variant}-shade)`}>
  <defs>
    <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="var(--avatar-light)" /><stop offset="0.55" stop-color="var(--avatar-body)" /><stop offset="1" stop-color="var(--avatar-shade)" />
    </linearGradient>
    <linearGradient id={`${uid}-shine`} x1="0" y1="0" x2="0.8" y2="1"><stop stop-color="var(--text)" stop-opacity="0.5" /><stop offset="1" stop-color="var(--text)" stop-opacity="0" /></linearGradient>
  </defs>
  <ellipse cx="24" cy="43" rx="14" ry="3" fill="var(--on-primary)" opacity="0.35" />
  <path d={shape} transform="translate(0 3)" fill="var(--on-primary)" opacity="0.8" />
  <path d={shape} fill={`url(#${uid}-body)`} />
  <path d={shape} fill={`url(#${uid}-shine)`} transform="translate(3 3) scale(.85 .65)" />
  <ellipse cx="17.5" cy="23" rx="5" ry="6" fill="var(--text)" /><ellipse cx="30.5" cy="23" rx="5" ry="6" fill="var(--text)" />
  <ellipse cx="19" cy="24" rx="2.5" ry="3.5" fill="var(--on-primary)" /><ellipse cx="29" cy="24" rx="2.5" ry="3.5" fill="var(--on-primary)" />
  <circle cx="19.7" cy="22.5" r="1" fill="var(--text)" /><circle cx="29.7" cy="22.5" r="1" fill="var(--text)" />
  <ellipse cx="12" cy="29" rx="3" ry="1.5" fill="var(--error)" opacity="0.5" /><ellipse cx="36" cy="29" rx="3" ry="1.5" fill="var(--error)" opacity="0.5" />
  <path d={variant % 2 ? "M20 32Q24 36 28 32" : "M20 31Q24 37 28 31Z"} fill={variant % 2 ? "none" : "var(--on-primary)"} stroke="var(--on-primary)" stroke-width="1.5" stroke-linecap="round" />
</svg>

<style>
  .subagent-avatar { flex: none; overflow: visible; }
</style>
