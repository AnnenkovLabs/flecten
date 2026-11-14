import { prefersReducedMotion } from "../motion";

export type LearningOrigin = { stage: DOMRect; character: DOMRect };

/** The trailer's 30-frame dive keeps the existing portrait in place before expanding its room. */
export function learningEntrance(node: HTMLElement, origin?: LearningOrigin) {
  if (!origin || prefersReducedMotion()) return;
  const room = node.getBoundingClientRect();
  const character = node.querySelector<HTMLElement>(".learning-character");
  if (!character) return;
  const destination = character.getBoundingClientRect();
  const top = Math.max(0, origin.stage.top - room.top);
  const right = Math.max(0, room.right - origin.stage.right);
  const bottom = Math.max(0, room.bottom - origin.stage.bottom);
  const left = Math.max(0, origin.stage.left - room.left);
  const timing = { duration: 500, easing: "cubic-bezier(0.65, 0, 0.35, 1)" };
  const roomAnimation = node.animate(
    [
      { clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round 18px)` },
      { clipPath: "inset(0px round 0px)" },
    ],
    timing,
  );
  const scale = destination.width / character.offsetWidth;
  const x =
    (origin.character.x + origin.character.width / 2 - destination.x - destination.width / 2) /
    scale;
  const y =
    (origin.character.y + origin.character.height / 2 - destination.y - destination.height / 2) /
    scale;
  const portraitAnimation = character.animate(
    [
      {
        transform: `translate(${x}px,${y}px) scale(${origin.character.width / destination.width})`,
      },
      { transform: "translate(0px,0px) scale(1)" },
    ],
    timing,
  );
  return {
    pause(value: boolean) {
      for (const animation of [roomAnimation, portraitAnimation]) {
        if (prefersReducedMotion()) animation.finish();
        else if (value) animation.pause();
        else if (animation.playState === "paused") animation.play();
      }
    },
    destroy() {
      roomAnimation.cancel();
      portraitAnimation.cancel();
    },
  };
}
