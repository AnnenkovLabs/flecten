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

  set(state: TwinState, emotion: TwinEmotion): void {
    if (state === this.state && emotion === this.emotion) return;
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

  frame(delta: number, still: boolean): TwinPose {
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
    return {
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
        (value, index) => value + (learning ? Math.max(0, Math.sin(t * 3 + index * 2)) * 0.16 : 0),
      ),
      uSquash: 1 + breathing - pulse * 0.14 - this.#anger * 0.04,
      uLift: still || age > 0.65 ? 0 : Math.sin((Math.PI * age) / 0.65) * 0.23,
      uTuft: this.#tuft + (still ? 0 : Math.sin(t * 1.4) * 0.04) - pulse * 0.2,
      uBend: [Math.sin(this.#yaw) * 0.025, breathing, pulse * 0.03],
      uFlow: [-(this.#gaze[0] ?? 0) * 0.03, -pulse * 0.1, 0],
      uGlow: learning ? 0.12 + Math.sin(t * 2) * 0.08 : 0,
      uRipple: [0, 0, 1, age < 1.5 && !still ? age : -1],
      uRipple2: [0, 0, 1, -1],
    };
  }
}
