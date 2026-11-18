import { drawRescueCast } from "./sidebar-rescue-cast";
import { sidebarRescueStory } from "./sidebar-rescue-story";

const BAND = 88;

export function playSidebarRescue(drawer: HTMLElement, rows: HTMLElement[]) {
  const stage = document.createElement("canvas");
  const ctx = stage.getContext("2d");
  let width = drawer.clientWidth;
  if (!ctx || !width || !rows.length) return;

  drawer.dataset.chatReveal = "rescue";
  const origin = drawer.getBoundingClientRect();
  const layout = rows.map((row) => {
    const rect = row.getBoundingClientRect();
    return {
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
    };
  });
  const story = sidebarRescueStory(layout);
  const figureScale = rows.length === 1 ? Math.min(1, (layout[0]?.height ?? 38) / 39) : 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  stage.width = Math.ceil(width * dpr);
  stage.height = Math.ceil(BAND * dpr);
  stage.style.width = `${width}px`;
  stage.style.height = `${BAND}px`;
  stage.className = "sidebar-rescue-stage";
  stage.setAttribute("aria-hidden", "true");
  ctx.scale(dpr, dpr);
  const style = getComputedStyle(drawer);
  const palette = {
    lead: style.getPropertyValue("--primary").trim(),
    partner: style.getPropertyValue("--text").trim(),
    fill: style.getPropertyValue("--sidebar").trim(),
  };
  for (const row of rows) row.dataset.rescueCard = "waiting";
  drawer.append(stage);

  let active = rows.length;
  let frame = 0;
  let running = true;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clock = performance.now();

  function release(row: HTMLElement) {
    delete row.dataset.rescueCard;
    row.style.removeProperty("transform");
    row.style.removeProperty("clip-path");
    row.style.removeProperty("--card-cover");
  }

  function render(time: number): void {
    const elapsed = Math.max(0, time - clock);
    if (elapsed >= story.duration || !drawer.isConnected) {
      stop();
      return;
    }
    const shot = story.sample(elapsed);
    const next = shot.phase === "exit" ? -1 : shot.index;
    for (let i = Math.min(active, rows.length - 1); i > next; i--) {
      const placed = rows[i];
      if (placed) {
        release(placed);
        placed.dataset.rescueCard = "stack";
      }
    }
    active = next;
    const row = rows[active];
    if (row) {
      row.dataset.rescueCard = "pull";
      row.style.transform = `translateY(${shot.dy}px) scaleX(${shot.scale})`;
      row.style.clipPath = `inset(${shot.clipped}px 0 0 round 5px)`;
      row.style.setProperty("--card-cover", `${shot.cover * 100}%`);
    }

    drawer.style.setProperty("--stack-shift", `${shot.stackShift}px`);
    if (ctx) {
      ctx.clearRect(0, 0, width, BAND);
      ctx.save();
      ctx.scale(figureScale, figureScale);
      drawRescueCast(
        ctx,
        {
          ...shot,
          width: width / figureScale,
          left: [shot.left[0] / figureScale, shot.left[1] / figureScale],
          right: [shot.right[0] / figureScale, shot.right[1] / figureScale],
        },
        palette,
      );
      ctx.restore();
    }
    frame = requestAnimationFrame(render);
  }

  function stop(): void {
    if (!running) return;
    running = false;
    cancelAnimationFrame(frame);
    for (const row of rows) release(row);
    stage.remove();
    delete drawer.dataset.chatReveal;
    drawer.style.removeProperty("--stack-shift");
    motion.removeEventListener("change", stop);
    document.removeEventListener("visibilitychange", stop);
    resize.disconnect();
  }

  const resize = new ResizeObserver(([entry]) => {
    const next = entry && Math.round(entry.contentRect.width);
    if (next === undefined || next === width) return;
    if (next === 0) return stop();
    // Opening the list can introduce a scrollbar. Keep both grips on the row
    // when the drawer narrows instead of ending the scene on its first frame.
    for (const row of layout) row.width += next - width;
    width = next;
    stage.width = Math.ceil(width * dpr);
    stage.style.width = `${width}px`;
    ctx.scale(dpr, dpr);
  });
  resize.observe(drawer);
  motion.addEventListener("change", stop);
  document.addEventListener("visibilitychange", stop);
  render(clock);
  return stop;
}
