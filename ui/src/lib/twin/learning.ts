import { LEARNING, type LearningCard, learningCards } from "./learning-stream";
import type { TwinPose } from "./pose";

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const out3 = (t: number) => 1 - (1 - t) ** 3;
const io = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const frequency = (period: number) => (2 * Math.PI) / period;
const impulse = (age: number, amplitude: number, period: number, decay: number) =>
  age < 0 ? 0 : amplitude * Math.exp(-age / decay) * Math.cos(frequency(period) * age);
const hash = (n: number) => {
  const x = Math.sin(n * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
};
type Spring = { x: number; v: number };
const seed = (x = 0, v = 0): Spring => ({ x, v });
function step(value: Spring, target: number, speed: number, damping: number, force = 0) {
  value.v += speed * speed * (target - value.x) - 2 * damping * speed * value.v + force;
  value.x += value.v;
}
function reach(frame: number, at: number): number {
  if (frame <= at - 16 || frame >= at + 6) return 0;
  return frame < at - 3
    ? 0.6 * out3((frame - at + 16) / 13)
    : 0.6 * (1 - ((frame - at + 3) / 9) ** 2);
}
function gaze(frame: number, cards: LearningCard[]): [number, number] {
  const glance = [...cards].reverse().find((card) => frame >= card.a + 6 && frame < card.a + 20);
  const next = cards.find((card) => card.a <= frame && card.at > frame);
  const card = glance ?? next;
  if (!card) return [0, 0.06];
  let x = card.side * 0.68,
    y = card.y < 560 ? 0.34 : -0.02;
  if (!glance && frame >= card.at - 15) {
    x *= 0.35;
    y = y * 0.4 - 0.12;
  }
  const n = Math.floor((frame - card.a) / 22);
  if (n > 0) {
    x += (hash(card.a + n) - 0.5) * 0.09;
    y += (hash(card.a + n + 50) - 0.5) * 0.06;
  }
  return [x, y];
}
function ripple(frame: number, card?: LearningCard): number[] {
  if (!card) return [0, 0, 1, -1];
  const x = card.side * 0.9,
    y = clamp((730 - card.y) / 230, -1, 1) * 0.6;
  const length = Math.hypot(x, y, 0.45);
  return [x / length, y / length, 0.45 / length, (frame - card.at) / LEARNING.fps];
}

/** Persistent v12 spring physics. Each real stream card pushes the same body. */
export class LearningRig {
  #frame = LEARNING.start - 1;
  // The trailer's incoming spring velocities preserve the train-click settling.
  #bx = seed(0.02811246182102872, -0.00012740218448771892);
  #bz = seed(0.011914031321885735, 0.000796872284137426);
  #twist = seed(-0.00078965356535474, -0.0009554579399915529);
  #ex = seed(0.00348509922197663, 0.007988548947541592);
  #ey = seed(0.17695826579909382, -0.006946644937278562);
  #yaw = seed(0.01729678795485613, -0.007171269032027132);
  #pitch = seed(-0.011986291224171247, -0.0027959954171386855);
  #tuft = seed(0.20153390487657294, 0.0020782318494273755);
  #arms = [
    seed(-0.05079367538152112, -0.009802738975868378),
    seed(-0.05079367538152112, -0.009802738975868378),
    seed(),
    seed(),
  ];
  #blinkAt = 1298;
  #nextBlink = 1298;

  #advance(frame: number, completionAt: number | undefined) {
    const complete = completionAt !== undefined && frame >= completionAt;
    const completionAge = complete ? frame - completionAt : -1;
    const cards = learningCards(frame);
    if (!complete) {
      for (const card of cards) if (frame === Math.ceil(card.at)) this.#bx.v -= card.side * 0.017;
    }
    step(
      this.#bx,
      0.022 * Math.sin(frequency(205) * frame + 0.4) + 0.012 * Math.sin(frequency(131) * frame + 2),
      frequency(25),
      0.17,
    );
    step(this.#bz, 0.018 * Math.sin(frequency(118) * frame + 1.1), frequency(27), 0.2);
    step(
      this.#twist,
      0.035 * Math.sin(frequency(233) * frame) + 0.25 * this.#bx.x,
      frequency(31),
      0.2,
    );
    const [x, y]: [number, number] = complete ? [0, 0.06] : gaze(frame, cards);
    step(this.#ex, x, 0.95, 0.72);
    step(this.#ey, y, 0.95, 0.72);
    step(this.#yaw, 0.22 * this.#ex.x + 0.6 * this.#bx.x, frequency(40), 0.5);
    step(this.#pitch, -0.1 * this.#ey.x, frequency(44), 0.55);
    const targets: [number, number, number, number] = [0, 0, 0, 0];
    if (!complete) {
      for (const card of cards) {
        const amount = reach(frame, card.at),
          side = card.side < 0 ? 0 : 1;
        targets[side] += amount * 0.6;
        const forward = side === 0 ? 2 : 3;
        targets[forward] += amount;
      }
    } else {
      const yay =
        completionAge < 8
          ? 0.9 * out3(completionAge / 8)
          : mix(0.9, 0.75, io(clamp((completionAge - 8) / 28)));
      targets[0] = yay;
      targets[1] = yay;
    }
    this.#arms.forEach((arm, index) => {
      step(arm, targets[index] ?? 0, frequency(16), 0.42);
    });
    step(
      this.#tuft,
      0.2 * Math.sin(frequency(140) * frame),
      frequency(22),
      0.16,
      -0.35 * this.#bx.v,
    );
    if (frame >= this.#nextBlink) {
      this.#blinkAt = frame;
      this.#nextBlink = frame + 130 + Math.floor(hash(frame) * 120);
    }
  }

  frame(frame: number, completionFrame?: number): TwinPose {
    frame = Math.max(LEARNING.start, frame, this.#frame);
    const completionAt =
      completionFrame === undefined ? undefined : frame - Math.max(0, completionFrame);
    // ponytail: warm up at most 4s after an unobserved clock jump; use an offline
    // fixed-step replay if exact reconstruction across long hidden gaps is needed.
    this.#frame = Math.max(this.#frame, Math.floor(frame) - 240);
    while (this.#frame < Math.floor(frame)) this.#advance(++this.#frame, completionAt);
    const complete = completionAt !== undefined;
    const age = complete ? Math.max(0, completionFrame ?? 0) : -1;
    const absorbed = learningCards(frame).filter(
      (card) => card.at <= frame && (!complete || card.at <= completionAt),
    );
    let smile = complete ? mix(0.62, 1.05, out3(clamp(age / 6))) : 0.62;
    let squash = 1 + 0.014 * Math.sin(frequency(118) * frame + 1.1);
    let glow = 0;
    for (const card of absorbed) {
      smile += 0.12 * Math.exp(-(frame - card.at) / 10);
      squash += impulse(frame - card.at, -0.06, 13, 6);
      glow += 0.55 * Math.exp(-(frame - card.at) / 14);
    }
    if (complete) {
      squash += impulse(age - 1, -0.09, 14, 7);
      glow += 0.5 * Math.exp(-Math.max(0, age - 4) / 26);
    }
    const blinkAge =
      frame < this.#nextBlink && frame >= this.#nextBlink - 3
        ? frame - this.#nextBlink
        : frame - this.#blinkAt;
    const blink =
      blinkAge >= -3 && blinkAge <= 6
        ? blinkAge < 0
          ? out3((blinkAge + 3) / 3)
          : 1 - io(blinkAge / 6)
        : 0;
    return {
      uT: frame / LEARNING.fps,
      uFur: 1,
      uLimbs: 1,
      uEyes: 1,
      uAnger: 0,
      uBlink: clamp(Math.max(blink, 0.32 * clamp((smile - 0.88) / 0.12))),
      uSmile: clamp(smile, 0, 1.05),
      uLook: [this.#ex.x, this.#ey.x],
      uYaw: this.#yaw.x,
      uTilt: [
        0.03 * Math.sin(frequency(170) * frame + 1.3) + 0.35 * this.#bx.x,
        this.#pitch.x - 0.05 * this.#ey.x,
      ],
      uArms: this.#arms.map((arm) => arm.x),
      uSquash: squash,
      uLift: complete && age > 7 && age < 27 ? 0.23 * Math.sin((Math.PI * (age - 7)) / 20) : 0,
      uTuft: clamp(this.#tuft.x, -0.65, 0.65),
      uFlow: [clamp(-1.5 * this.#bx.x, -0.8, 0.8), 0, 0],
      uBend: [
        clamp(this.#bx.x, -0.3, 0.3),
        clamp(this.#bz.x, -0.2, 0.2),
        clamp(this.#twist.x, -0.25, 0.25),
      ],
      uGlow: Math.min(1, glow),
      uRipple: ripple(frame, absorbed.at(-1)),
      uRipple2: ripple(frame, absorbed.at(-2)),
    };
  }
}
