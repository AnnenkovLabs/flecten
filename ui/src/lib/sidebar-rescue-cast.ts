import { drawRescueActor, type Point, type RescueActor } from "./sidebar-rescue-actor";

type Side = 1 | -1;
type Cast = {
  width: number;
  phase: "split" | "haul" | "exit";
  progress: number;
  index: number;
  left: Point;
  right: Point;
  startY: number;
};
type Palette = { lead: string; partner: string; fill: string };

const WING = 17;
const TAU = Math.PI * 2;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const part = (t: number, start: number, end: number) =>
  Math.max(0, Math.min(1, (t - start) / (end - start)));
const ease = (t: number) => t * t * (3 - 2 * t);
const beat = (t: number, start: number, end: number) => ease(part(t, start, end));
const coords = (a: Point, b: Point, t: number): Point => [mix(a[0], b[0], t), mix(a[1], b[1], t)];

/** The left worker's pose mirrors at the opposite wing; grip and feet can animate independently. */
function stance(x: number, floor: number, side: Side, lean = 0, crouch = 0): RescueActor {
  const at = (dx: number, dy: number): Point => [x + dx * side, floor + dy];
  return {
    hips: at(-lean * 0.3, -13 + crouch),
    shoulder: at(lean, -23 + crouch),
    hands: [at(-5 + lean, -12 + crouch), at(7 + lean, -15 + crouch)],
    feet: [at(-6, 0), at(6, 0)],
    facing: side,
    mood: "alert",
    squash: 1 - crouch * 0.026,
  };
}

function running(
  x: number,
  floor: number,
  facing: Side,
  cycle: number,
  effort: number,
): RescueActor {
  const swing = Math.sin(cycle * TAU);
  const bob = Math.abs(Math.cos(cycle * TAU)) * effort;
  const step = 9 * swing * effort;
  const actor = stance(x, floor, facing, effort * 4, 2 - 5 * bob);
  actor.feet = [
    [x + facing * (-4 + step), floor - 7 * Math.max(0, Math.cos(cycle * TAU)) * effort],
    [x + facing * (4 - step), floor - 7 * Math.max(0, -Math.cos(cycle * TAU)) * effort],
  ];
  actor.hands = [
    [x + facing * (0 - step), floor - 19 - 3 * bob],
    [x + facing * (3 + step), floor - 19 - 3 * bob],
  ];
  return actor;
}

function blend(a: RescueActor, b: RescueActor, t: number): RescueActor {
  return {
    ...b,
    hips: coords(a.hips, b.hips, t),
    shoulder: coords(a.shoulder, b.shoulder, t),
    hands: [coords(a.hands[0], b.hands[0], t), coords(a.hands[1], b.hands[1], t)],
    feet: [coords(a.feet[0], b.feet[0], t), coords(a.feet[1], b.feet[1], t)],
    mood: t < 0.5 ? a.mood : b.mood,
    facing: (t < 0.6 ? a.facing : b.facing) ?? 1,
    squash: mix(a.squash ?? 1, b.squash ?? 1, t),
  };
}

function split(cast: Cast, side: Side, wing: number): RescueActor {
  const entry = side === 1 ? 0 : 0.11;
  const t = part(cast.progress, entry, side === 1 ? 0.87 : 0.97);
  const mouth = cast.width * (side === 1 ? 0.4 : 0.63);
  const landing = mouth - side * 10;
  const floor = cast.startY;
  const wait = stance(wing, floor, side);

  // The first worker clings for a moment; the second lands feet first after watching the slip.
  if (t < 0.48) {
    const fall = part(t, side === 1 ? 0.2 : 0.08, 0.39);
    const fallEase = fall * fall;
    const catchGround = beat(t, 0.39, 0.48);
    const x = mix(mouth, landing, fallEase);
    const actor = stance(
      x,
      mix(-2, floor, fallEase),
      side,
      side === 1 ? -5 * Math.sin(Math.PI * fall) : 1,
      Math.sin(Math.PI * catchGround) * 6 + 3 * beat(t, 0.35, 0.39) * (1 - catchGround),
    );
    const release = beat(t, side === 1 ? 0.22 : 0.07, 0.36);
    actor.hands = [
      coords([mouth - 4, 2], actor.hands[0], release),
      coords([mouth + 4, 2], [x + side * 8, actor.hands[1][1] - 6], release),
    ];
    actor.mood = t < 0.17 ? "alert" : t < 0.39 ? "surprised" : "strain";
    actor.opacity = beat(cast.progress, entry, entry + 0.06);
    return actor;
  }

  const dash = part(t, 0.49, 0.94);
  const run = running(mix(landing, wing, ease(dash)), floor, side === 1 ? -1 : 1, dash * 3.8, 1);
  const arrival = beat(t, 0.82, 1);
  const takeoff = stance(landing, floor, side, side === 1 ? 0 : 1);
  takeoff.hands = [takeoff.hands[0], [landing + side * 8, takeoff.hands[1][1] - 6]];
  takeoff.mood = "strain";
  return blend(blend(takeoff, run, beat(t, 0.48, 0.56)), wait, arrival);
}

function drawRope(
  ctx: CanvasRenderingContext2D,
  hand: Point,
  anchor: Point,
  ink: string,
  slack: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const link = coords(hand, anchor, 0.5);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(...hand);
  ctx.quadraticCurveTo(link[0], link[1] + slack, ...anchor);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(...anchor, 1.65, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function haul(ctx: CanvasRenderingContext2D, cast: Cast, side: Side, wing: number, ink: string) {
  const t = cast.progress;
  const anchor = side === 1 ? cast.left : cast.right;
  const delay = side === 1 ? 0 : 0.04;
  const grip = beat(t, 0.12 + delay, 0.27 + delay);
  const release = beat(t, 0.78 + delay, 0.91 + delay);
  const hold = grip * (1 - release);
  const brace = beat(t, 0.27 + delay, 0.4 + delay);
  const tighten = beat(t, 0.25 + delay, 0.37 + delay);
  const dip = Math.sin(Math.PI * part(t, 0.38, 0.76));
  const skid = (cast.index + (side === 1 ? 0 : 1)) % 3 === 1;
  const stumble = skid ? Math.sin(Math.PI * part(t, 0.47, 0.66)) : 0;
  const floor = cast.startY;
  const lean = (3 * (1 - brace) - 5 * brace + 6 * stumble) * hold;
  const x = wing - side * (2 * brace + 2 * stumble) * hold;
  const actor = stance(x, floor, side, lean, hold * (2 + 4 * dip));
  const glove: Point = [wing + side * (4 + 2 * (1 - tighten)), anchor[1] - 2 - 3 * tighten];
  const support: Point = [glove[0] - side * 3.5, glove[1] - 2];

  // The knot follows the live card corner, not a second timeline. Release leaves the ropes slack.
  actor.hands = [coords(actor.hands[0], support, hold), coords(actor.hands[1], glove, hold)];
  actor.feet = [
    [x - side * (6 + 3 * brace * hold), floor - 5 * stumble * hold],
    [x + side * (6 - 2 * stumble * hold), floor - 2 * dip * hold],
  ];
  actor.mood =
    release > 0.58 ? "happy" : stumble > 0.55 ? "surprised" : brace > 0.35 ? "strain" : "alert";
  actor.mood = release >= 1 ? "alert" : actor.mood;
  drawRope(ctx, actor.hands[1], anchor, ink, (1 - tighten + release) * 5, hold);
  return actor;
}

function exit(cast: Cast, side: Side, wing: number): RescueActor {
  const t = part(cast.progress, side === 1 ? 0 : 0.1, 1);
  const wave = beat(t, 0.02, 0.19) * (1 - beat(t, 0.49, 0.63));
  const turn = beat(t, 0.52, 0.66);
  const leave = part(t, 0.59, 1);
  const floor = cast.startY;
  const wavePose = stance(wing, floor, side);
  wavePose.mood = t < 0.04 ? "alert" : "happy";
  wavePose.hands = [
    coords(wavePose.hands[0], [wing - side * (7 + 3 * Math.sin(t * TAU * 5)), floor - 36], wave),
    wavePose.hands[1],
  ];
  const run = running(wing - side * 35 * leave, floor, side === 1 ? -1 : 1, leave * 2.1, 1);
  run.mood = "happy";
  const actor = blend(wavePose, run, turn);
  actor.opacity = 1 - beat(t, 0.8, 1);
  return actor;
}

export function drawRescueCast(ctx: CanvasRenderingContext2D, cast: Cast, palette: Palette): void {
  for (const side of [1, -1] as const) {
    const ink = side === 1 ? palette.lead : palette.partner;
    const wing = side === 1 ? WING : cast.width - WING;
    const actor =
      cast.phase === "split"
        ? split(cast, side, wing)
        : cast.phase === "haul"
          ? haul(ctx, cast, side, wing, ink)
          : exit(cast, side, wing);
    drawRescueActor(ctx, actor, ink, palette.fill);
  }
}
