import { LearningRig } from "./learning";
import {
  TWIN_FALLING_MS,
  TWIN_PLEADING_MS,
  TWIN_REVIVING_MS,
  type TwinPowerFrame,
  type TwinPowerPhase,
  twinFallFrame,
} from "./power";

export type TwinState = "idle" | "learning" | "ready" | "answer";
export type TwinEmotion = "calm" | "pleased" | "angry" | "furious";
export type TwinPose = Record<string, number | number[]>;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Rest/learning/acceptance poses from v12 twinPose(1180/1370/1518/1660).
// Film timing is replaced by real input and product state; the original shader owns the geometry.
const poses: Record<TwinState, { smile: number; arms: number[]; tilt: number; tuft: number }> = {
  idle: { smile: 0.898, arms: [0, 0, 0, 0], tilt: 0.161, tuft: 0.09 },
  learning: { smile: 0.603, arms: [0, 0, 0, 0], tilt: 0.018, tuft: -0.2 },
  ready: { smile: 1.05, arms: [1.08, 1.01, 0.09, -0.025], tilt: 0.039, tuft: -0.283 },
  answer: { smile: 1, arms: [0.638, 0.511, 0.012, 0.012], tilt: 0.001, tuft: -0.15 },
};

/** Interruptible pose transitions, gaze and turntable in the trailer's own rig coordinates. */
export class TwinRig {
  state: TwinState = "idle";
  emotion: TwinEmotion = "calm";
  #look = [0, 0];
  #yaw = 0;
  #turn = 0;
  #gaze = [0, 0];
  #anger = 0;
  #smile = poses.idle.smile;
  #arms = [...poses.idle.arms];
  #tilt = poses.idle.tilt;
  #tuft = poses.idle.tuft;
  #impulse = -10;
  #time = 0;
  #learning = new LearningRig();
  #powerPhase: TwinPowerPhase = "enabled";
  #powerPose: TwinPose | undefined;
  #reviveFrom: TwinPose | undefined;

  set(state: TwinState, emotion: TwinEmotion): void {
    if (state === this.state && emotion === this.emotion) return;
    if (state === "learning" && this.state !== "learning") this.#learning = new LearningRig();
    this.state = state;
    this.emotion = emotion;
  }

  look(x: number, y: number): void {
    this.#look = [clamp(x, -1, 1), clamp(y, -1, 1)];
  }

  turn(delta: number): void {
    this.#turn += delta;
  }

  reset(): void {
    this.#turn = 0;
    this.look(0, 0);
  }

  greet(): void {
    this.#impulse = this.#time;
  }

  frame(
    delta: number,
    still: boolean,
    learningFrame?: number,
    completionFrame?: number,
    powerFrame?: TwinPowerFrame,
  ): TwinPose {
    if (this.state === "learning" && learningFrame !== undefined)
      return this.#power(this.#learning.frame(learningFrame, completionFrame), powerFrame, still);
    const dt = clamp(delta, 0, 0.05);
    if (!still) this.#time += dt;
    const t = this.#time;
    const age = t - this.#impulse;
    const pulse = still || age > 1.5 ? 0 : Math.sin(age * 18) * Math.exp(-age * 4);
    const anger = this.emotion === "furious" ? 1 : this.emotion === "angry" ? 0.7 : 0;
    const target = poses[this.state];
    const follow = still ? 1 : 1 - Math.exp(-dt * 12);
    const mix = (from: number, to: number) => from + (to - from) * follow;
    this.#anger = mix(this.#anger, anger);
    this.#smile = mix(this.#smile, anger ? 0 : target.smile);
    this.#tilt = mix(this.#tilt, anger ? 0 : target.tilt);
    this.#tuft = mix(this.#tuft, target.tuft);
    this.#yaw = mix(this.#yaw, this.#turn + (this.#look[0] ?? 0) * 0.18);
    this.#gaze = this.#gaze.map((value, index) => mix(value, (this.#look[index] ?? 0) * 0.7));
    this.#arms = this.#arms.map((value, index) =>
      mix(value, anger ? (index < 2 ? 0.16 : 0.45) : (target.arms[index] ?? 0)),
    );
    const breathing = still ? 0 : Math.sin(t * 2.4) * 0.012;
    const blinkPhase = t % 4.7;
    const blink = still ? 0 : Math.max(0, 1 - Math.abs(blinkPhase - 4.4) / 0.12);
    const learning = !still && this.state === "learning";
    return this.#power(
      {
        uT: t,
        uFur: 1,
        uLimbs: 1,
        uEyes: 1,
        uBlink: Math.max(blink, this.#anger * 0.12),
        uSmile: this.#smile,
        uAnger: this.#anger,
        uLook: this.#gaze,
        uYaw: this.#yaw,
        uTilt: [this.#tilt + (this.#gaze[0] ?? 0) * 0.035, -(this.#gaze[1] ?? 0) * 0.1],
        uArms: this.#arms.map(
          (value, index) =>
            value + (learning ? Math.max(0, Math.sin(t * 3 + index * 2)) * 0.16 : 0),
        ),
        uSquash: 1 + breathing - pulse * 0.14 - this.#anger * 0.04,
        uLift: still || age > 0.65 ? 0 : Math.sin((Math.PI * age) / 0.65) * 0.23,
        uTuft: this.#tuft + (still ? 0 : Math.sin(t * 1.4) * 0.04) - pulse * 0.2,
        uBend: [Math.sin(this.#yaw) * 0.025, breathing, pulse * 0.03],
        uFlow: [-(this.#gaze[0] ?? 0) * 0.03, -pulse * 0.1, 0],
        uGlow: learning ? 0.12 + Math.sin(t * 2) * 0.08 : 0,
        uRipple: [0, 0, 1, age < 1.5 && !still ? age : -1],
        uRipple2: [0, 0, 1, -1],
      },
      powerFrame,
      still,
    );
  }

  #power(base: TwinPose, power: TwinPowerFrame | undefined, still: boolean): TwinPose {
    const defaults = {
      uSadness: 0,
      uTears: 0,
      uGrey: 0,
      uHearts: 0,
      uHeartTime: 0,
      uFall: 0,
      uImpact: 0,
      uReach: [0, 0],
    };
    const phase = power?.phase ?? "enabled";
    if (phase === "enabled") {
      this.#powerPhase = phase;
      this.#powerPose = undefined;
      return { ...base, ...defaults };
    }
    const elapsed = Math.max(0, power?.elapsed ?? 0);
    const smooth = (value: number) => {
      const t = clamp(value, 0, 1);
      return t * t * (3 - 2 * t);
    };
    const plea = phase === "pleading" ? clamp(elapsed / (TWIN_PLEADING_MS / 1000), 0, 1) : 1;
    const tear = smooth(elapsed / 1.1);
    const weak = smooth((plea - 0.8125) / 0.1875);
    const reach = (0.25 + 0.75 * smooth(plea / 0.8125)) * (1 - weak * 0.24);
    const falling = phase === "falling" || phase === "disabled";
    const fallFrame = twinFallFrame(phase === "disabled" ? TWIN_FALLING_MS / 1000 : elapsed);
    const pitch = falling ? fallFrame.pitch : 0;
    const fall = clamp(pitch / 1.38, 0, 1);
    const impact = falling ? fallFrame.impact : 0;
    const contactAge = falling ? Math.max(0, fallFrame.contactAge) : 0;
    const brace = falling ? smooth((pitch - 0.45) / 0.45) * (1 - smooth(contactAge / 0.32)) : 0;
    const delayedAge = Math.max(0, contactAge - 0.1);
    const tuftFlop = falling ? (delayedAge / 0.08) * Math.exp(1 - delayedAge / 0.08) : 0;
    const sad: TwinPose = {
      ...base,
      ...defaults,
      uT: elapsed,
      uSadness: phase === "pleading" ? tear : 1,
      uTears: phase === "pleading" ? tear : 1 - smooth(contactAge / 0.65),
      uGrey: smooth(contactAge / 0.8),
      uFall: fall,
      uImpact: impact,
      uAnger: 0,
      uSmile: 0,
      uYaw: 0,
      uLook: [0, 0.28 * (1 - fall)],
      uTilt: [phase === "pleading" ? -0.04 - weak * 0.035 : -0.075 - fall * 0.005, pitch],
      uEyes: 1 + 0.15 * (1 - fall),
      uBlink: clamp(fall * 0.8 + impact * 0.4, 0, 1),
      uArms: [
        0.16 + brace * 0.18,
        0.4 - weak * 0.08 + brace * 0.12 - impact * 0.08,
        0.18 + brace * 0.65,
        1.65 - weak * 0.18 + brace * 0.12 - impact * 0.2,
      ],
      uReach: [0.12 + brace * 0.12, reach + brace * 0.12],
      uSquash: 1 - weak * 0.035 - fall * 0.04 - impact * 0.03,
      uLift: 1 - Math.cos(pitch),
      uBend: [
        0,
        phase === "pleading"
          ? 0.08 + reach * 0.08
          : phase === "falling"
            ? 0.1408 * (1 - smooth(elapsed / 0.5))
            : 0,
        0,
      ],
      uFlow: [0, -0.05 + impact * 0.1, -impact * 0.12],
      uTuft: -0.32 - weak * 0.12 + (falling ? fallFrame.velocity * 0.025 : 0) - tuftFlop * 0.12,
      uGlow: 0,
      uRipple: [
        0,
        0,
        1,
        phase === "falling" && fallFrame.contactAge >= 0 ? fallFrame.contactAge : -1,
      ],
      uRipple2: [0, 0, 1, -1],
    };
    if (phase === "reviving") {
      if (this.#powerPhase !== "reviving")
        this.#reviveFrom = this.#powerPose ?? {
          ...sad,
          uFall: 1,
          uGrey: 1,
          uTilt: [-0.08, 1.38],
          uLift: 1 - Math.cos(1.38),
        };
      const progress = still ? 1 : smooth(elapsed / ((TWIN_REVIVING_MS / 1000) * 0.72));
      const source = this.#reviveFrom ?? sad;
      const happy: TwinPose = {
        ...base,
        ...defaults,
        uT: elapsed,
        uYaw: 0,
        uLook: [0, 0.08],
        uAnger: 0,
        uSmile: 1.05,
        uArms: [0.86, 0.86, 0.22, 0.22],
        uTilt: [0.04, 0],
        uTuft: 0.1,
        uSquash: 1,
        uLift: 0,
        uBend: [0, 0, 0],
        uFlow: [0, 0, 0],
      };
      for (const [name, target] of Object.entries(happy)) {
        const from = source[name];
        if (typeof target === "number" && typeof from === "number")
          sad[name] = from + (target - from) * progress;
        else if (Array.isArray(target) && Array.isArray(from))
          sad[name] = target.map((v, i) => (from[i] ?? v) + (v - (from[i] ?? v)) * progress);
      }
      sad.uHearts = still ? 0.85 : smooth(elapsed / 0.45) * (1 - smooth((elapsed - 2.6) / 0.6));
      sad.uHeartTime = still ? 1.2 : elapsed;
    }
    this.#powerPhase = phase;
    this.#powerPose = sad;
    return sad;
  }
}
