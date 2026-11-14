import { LEARNING } from "./learning-stream";

/** A single visible clock drives both DOM cards and the character's original rig. */
export function learningPlayback(
  node: HTMLElement,
  update: (frame: number, still: boolean, completionFrame?: number) => void,
) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = false;
  let paused = false;
  let available = false;
  let completedAt: number | undefined;
  // Reduced motion opens on a readable, already settled stream without moving its clock later.
  let elapsed = motion.matches ? 78 : 0;
  let last = 0;
  let ticket = 0;
  let currentFrame: number = LEARNING.start + elapsed;
  const still = () => paused || motion.matches;

  function stop() {
    cancelAnimationFrame(ticket);
    ticket = 0;
    last = 0;
  }

  function draw(now: number) {
    ticket = 0;
    if (last && !still() && (available || completedAt !== undefined))
      elapsed += (Math.min(now - last, 100) * LEARNING.fps) / 1000;
    last = now;
    const completionFrame =
      completedAt === undefined
        ? undefined
        : Math.min(LEARNING.completionFrames, elapsed - completedAt);
    currentFrame = LEARNING.start + elapsed;
    update(currentFrame, still(), completionFrame);
    if (
      !still() &&
      (available || completedAt !== undefined) &&
      completionFrame !== LEARNING.completionFrames
    )
      ticket = requestAnimationFrame(draw);
    else last = 0;
  }

  function wake() {
    stop();
    if (visible && !document.hidden) ticket = requestAnimationFrame(draw);
    else update(currentFrame, true, completedAt === undefined ? undefined : elapsed - completedAt);
  }

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    wake();
  });
  intersection.observe(node);
  document.addEventListener("visibilitychange", wake);
  motion.addEventListener("change", wake);

  return {
    feed(value: boolean) {
      if (available === value) return;
      available = value;
      wake();
    },
    pause(value: boolean) {
      paused = value;
      wake();
    },
    finish(value: boolean) {
      if (value === (completedAt !== undefined)) return;
      completedAt = value ? elapsed : undefined;
      wake();
    },
    dispose() {
      stop();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", wake);
      motion.removeEventListener("change", wake);
    },
  };
}
