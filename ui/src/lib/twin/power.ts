export type TwinPowerPhase = "enabled" | "pleading" | "falling" | "disabled" | "reviving";

/** A shared wall-clock origin keeps every visible Twin in the same scene. */
export type TwinPowerVisual = { phase: TwinPowerPhase; since: number };
export type TwinPowerFrame = { phase: TwinPowerPhase; elapsed: number };

export const TWIN_PLEADING_MS = 8000;
export const TWIN_FALLING_MS = 2400;
export const TWIN_REVIVING_MS = 3200;

const fallStep = 1 / 240;
const restingPitch = 1.38;
const falling: { pitch: number; velocity: number }[] = [{ pitch: 0, velocity: 0.22 }];
let caught = false;
let handContact = 0;
// A rounded body tips under gravity; the reaching paw briefly takes weight, then slips.
// ponytail: one floor pivot; add articulated contacts if limbs become separate rigid bodies.
while ((falling.at(-1)?.pitch ?? 0) < restingPitch) {
  const previous = falling.at(-1);
  if (!previous) break;
  let velocity = previous.velocity + 18 * Math.sin(previous.pitch) * fallStep;
  const pitch = Math.min(restingPitch, previous.pitch + velocity * fallStep);
  if (!caught && pitch >= 0.78) {
    caught = true;
    handContact = falling.length * fallStep;
    velocity *= 0.5;
  }
  falling.push({ pitch, velocity });
}
export const TWIN_HAND_CONTACT_MS = handContact * 1000;
export const TWIN_FALL_CONTACT_MS = (falling.length - 1) * fallStep * 1000;

/** Wall-clock sampling makes contact and impact independent of render rate or hidden time. */
export function twinFallFrame(seconds: number) {
  const time = Math.max(0, seconds);
  const index = Math.min(falling.length - 1, Math.floor(time / fallStep));
  const from = falling[index] ?? falling[0];
  const to = falling[index + 1] ?? from;
  if (!from || !to) throw new Error("Twin fall trajectory is empty");
  const fraction = Math.min(1, time / fallStep - index);
  const contactAge = time - TWIN_FALL_CONTACT_MS / 1000;
  const settle = Math.max(0, Math.min(1, (TWIN_FALLING_MS / 1000 - time) / 0.35));
  const impactAge = Math.max(0, contactAge);
  // Low restitution and critical damping give one small recoil, without a bounce cycle.
  const recoil = to.velocity * 0.06 * impactAge * Math.exp(-impactAge / 0.075) * settle;
  const impact = (impactAge / 0.065) * Math.exp(1 - impactAge / 0.065) * settle;
  return {
    pitch: from.pitch + (to.pitch - from.pitch) * fraction - recoil,
    velocity: contactAge >= 0 ? 0 : from.velocity + (to.velocity - from.velocity) * fraction,
    contactAge,
    impact,
  };
}
