import { expect, test } from "bun:test";
import { TwinRig } from "../../ui/src/lib/twin/pose";
import {
  TWIN_FALL_CONTACT_MS,
  TWIN_FALLING_MS,
  TWIN_HAND_CONTACT_MS,
  TWIN_PLEADING_MS,
  TWIN_REVIVING_MS,
  twinFallFrame,
} from "../../ui/src/lib/twin/power";

const sample = (
  rig: TwinRig,
  phase: "pleading" | "falling" | "disabled" | "reviving",
  elapsed: number,
  still = false,
) => rig.frame(1 / 24, still, undefined, undefined, { phase, elapsed });

test("pleading overrides task anger, faces the user and slowly reaches before weakening", () => {
  const rig = new TwinRig();
  rig.set("answer", "furious");
  rig.turn(2);
  rig.look(1, -1);
  const early = sample(rig, "pleading", 0.5);
  const continuing = sample(rig, "pleading", 5.8);
  const reaching = sample(rig, "pleading", 6.5);
  const weary = sample(rig, "pleading", TWIN_PLEADING_MS / 1000);
  expect(reaching.uYaw).toBe(0);
  expect(reaching.uAnger).toBe(0);
  expect(reaching.uTears).toBe(1);
  expect(reaching.uEyes).toBeGreaterThan(1);
  expect(reaching.uGrey).toBe(0);
  expect((reaching.uReach as number[])[1]).toBeGreaterThan((early.uReach as number[])[1] ?? 0);
  expect((reaching.uReach as number[])[1]).toBeGreaterThan((continuing.uReach as number[])[1] ?? 0);
  expect((weary.uReach as number[])[1]).toBeLessThan((reaching.uReach as number[])[1] ?? 0);
});

test("gravity accelerates the tip, the paw catches weight and impact compresses before settling", () => {
  const handAt = TWIN_HAND_CONTACT_MS / 1000;
  const contactAt = TWIN_FALL_CONTACT_MS / 1000;
  expect(twinFallFrame(0.6).velocity).toBeGreaterThan(twinFallFrame(0.3).velocity * 2);
  expect(twinFallFrame(handAt + 0.01).velocity).toBeLessThan(twinFallFrame(handAt - 0.01).velocity);
  const rig = new TwinRig();
  const airborne = sample(rig, "falling", contactAt - 0.02);
  const contact = sample(rig, "falling", contactAt);
  const hurt = sample(rig, "falling", contactAt + 0.065);
  const settled = sample(rig, "falling", TWIN_FALLING_MS / 1000);
  expect(airborne.uGrey).toBe(0);
  expect(hurt.uImpact).toBeGreaterThan(0.99);
  expect(hurt.uSquash).toBeLessThan((contact.uSquash as number) - 0.025);
  expect(hurt.uBlink).toBe(1);
  expect((hurt.uTilt as number[])[1]).toBeLessThan((contact.uTilt as number[])[1] ?? 0);
  expect((hurt.uTilt as number[])[1]).toBeGreaterThan(1.35);
  expect(settled.uSquash).toBeGreaterThan(hurt.uSquash as number);
  expect(settled.uGrey).toBe(1);
  expect(settled.uImpact).toBe(0);
  for (let time = contactAt; time <= TWIN_FALLING_MS / 1000; time += 0.02)
    expect(twinFallFrame(time).pitch).toBeLessThanOrEqual(1.38);
});

test("falling rotates forward about the floor and ends in the durable grey pose", () => {
  const rig = new TwinRig();
  const halfway = sample(rig, "falling", TWIN_FALLING_MS / 2000);
  const fallen = sample(rig, "falling", TWIN_FALLING_MS / 1000);
  const restored = sample(new TwinRig(), "disabled", 0, true);
  expect((halfway.uTilt as number[])[1]).toBeGreaterThan(0);
  expect((fallen.uTilt as number[])[1]).toBeGreaterThan(1.3);
  expect(fallen.uLift).toBeCloseTo(1 - Math.cos((fallen.uTilt as number[])[1] ?? 0));
  for (const key of ["uTilt", "uLift", "uGrey", "uFall", "uReach", "uBlink", "uTears"])
    expect(restored[key]).toEqual(fallen[key]);
  expect(restored.uGrey).toBe(1);
  expect(restored.uTears).toBe(0);
});

test("reenabling interrupts the current reach or fall, then restores warmth with hearts", () => {
  for (const phase of ["pleading", "falling", "disabled"] as const) {
    const rig = new TwinRig();
    const before = sample(rig, phase, phase === "pleading" ? 8 : 1);
    const start = sample(rig, "reviving", 0);
    expect(start.uTilt).toEqual(before.uTilt);
    expect(start.uGrey).toEqual(before.uGrey);
    expect(start.uReach).toEqual(before.uReach);
    const happy = sample(rig, "reviving", 1.5);
    expect(happy.uHearts).toBeGreaterThan(0.9);
    const complete = sample(rig, "reviving", TWIN_REVIVING_MS / 1000);
    expect(complete.uGrey).toBe(0);
    expect(complete.uSadness).toBe(0);
    expect(complete.uFall).toBe(0);
    expect(complete.uSmile).toBe(1.05);
    expect((complete.uTilt as number[])[1]).toBe(0);
  }
});

test("still revival has a clear happy frame and enabled clears every effect uniform", () => {
  const rig = new TwinRig();
  const happy = sample(rig, "reviving", 0, true);
  expect(happy.uHearts).toBeGreaterThan(0);
  expect(happy.uGrey).toBe(0);
  expect(happy.uFall).toBe(0);
  const enabled = rig.frame(0, true);
  for (const name of ["uTears", "uSadness", "uGrey", "uHearts", "uFall", "uImpact"])
    expect(enabled[name]).toBe(0);
  expect(enabled.uReach).toEqual([0, 0]);
});
