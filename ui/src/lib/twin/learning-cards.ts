import type { LearningCard } from "./learning-stream";

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

// The trailer's CSS bezier solver, shared by arrival and absorption opacity.
function bezier(x: number, x1: number, y1: number, x2: number, y2: number): number {
  x = clamp(x);
  const sample = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0;
  let high = 1;
  let t = x;
  for (let index = 0; index < 24; index++) {
    const value = sample(t, x1, x2);
    if (Math.abs(value - x) < 0.000001) break;
    if (value < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return sample(t, y1, y2);
}

export const settle = (value: number) => bezier(value, 0.16, 1, 0.3, 1);
const master = (value: number) => bezier(value, 0.4, 0, 0.2, 1);

/** Original 1920 x 1080 card path, including the held readable phase and swallow arc. */
export function learningCardFrame(frame: number, card: LearningCard) {
  if (frame < card.a || frame > card.at + 1) return null;
  const hover = { x: 960 + card.side * 590, y: card.y };
  let x = hover.x;
  let y = hover.y;
  let scale = 1;
  let opacity = 1;
  let blur = 0;
  if (frame < card.a + 18) {
    const progress = (frame - card.a) / 18;
    const eased = settle(progress);
    x = mix(960 + card.side * 1320, hover.x, eased);
    y = mix(card.y + 40, hover.y, eased);
    opacity = clamp(progress * 2.2);
    blur = (1 - eased) * 4;
  } else if (frame >= card.at - 16) {
    const progress = clamp((frame - card.at + 16) / 16);
    const eased = progress ** 3;
    x = mix(hover.x, 960, eased);
    y = mix(card.y, 730, eased) - Math.sin(Math.PI * progress) * 34;
    scale = mix(1, 0.08, eased);
    opacity = 1 - master((progress - 0.55) / 0.45);
    blur = Math.max(0, progress - 0.3) * 6;
  }
  return { x, y, scale, opacity, blur };
}
