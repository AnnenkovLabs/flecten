import { playSidebarRescue } from "./sidebar-rescue-player";

const RESCUE_CHANCE = 0.15;
const RESCUE_RETRY_LIMIT = 8;
let openingsSinceRescue = 0;

export function revealSidebarChats(drawer: HTMLElement, eligibleForRescue: boolean): () => void {
  const rows = Array.from(drawer.querySelectorAll<HTMLElement>(".task"));
  if (rows.length === 0) return () => {};
  if (eligibleForRescue) {
    openingsSinceRescue = Math.min(openingsSinceRescue + 1, RESCUE_RETRY_LIMIT);
    if (openingsSinceRescue === RESCUE_RETRY_LIMIT || Math.random() < RESCUE_CHANCE) {
      const stop = playSidebarRescue(drawer, rows);
      if (stop) {
        openingsSinceRescue = 0;
        return stop;
      }
    }
  }

  drawer.dataset.chatReveal = "slide";
  const animations = rows.map((row, index) =>
    row.animate(
      [
        { opacity: 0, transform: "translateY(-15px)" },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: 190,
        delay: Math.min(index, 4) * 12,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "backwards",
      },
    ),
  );

  let running = true;
  function stop(): void {
    if (!running) return;
    running = false;
    for (const animation of animations) animation.cancel();
    delete drawer.dataset.chatReveal;
  }

  void Promise.allSettled(animations.map((animation) => animation.finished)).then(stop);
  return stop;
}
