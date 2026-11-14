import { expect, test } from "bun:test";
import { learningCardFrame } from "../../ui/src/lib/twin/learning-cards";
import { learningPlayback } from "../../ui/src/lib/twin/learning-playback";
import { LEARNING, learningCards } from "../../ui/src/lib/twin/learning-stream";
import { TwinRig } from "../../ui/src/lib/twin/pose";

test("the visible clock waits for real samples, then runs continuously through pause and completion", () => {
  const motion = Object.assign(new EventTarget(), { matches: false });
  const document = Object.assign(new EventTarget(), { hidden: false });
  const queue = new Map<number, FrameRequestCallback>();
  let ticket = 0;
  let now = 1;
  const stubs = {
    document,
    matchMedia: () => motion,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      queue.set(++ticket, callback);
      return ticket;
    },
    cancelAnimationFrame: (id: number) => {
      queue.delete(id);
    },
    IntersectionObserver: class {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.callback([{ isIntersecting: true }]);
      }
      disconnect() {}
    },
  };
  const originals = Object.keys(stubs).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(stubs))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  const draws: { frame: number; completion: number | undefined }[] = [];
  const advance = (milliseconds: number) => {
    const pending = [...queue.values()];
    queue.clear();
    now += milliseconds;
    for (const callback of pending) callback(now);
  };
  const clock = learningPlayback({} as HTMLElement, (frame, _still, completion) => {
    draws.push({ frame, completion });
  });
  try {
    advance(5000);
    expect(draws.at(-1)?.frame).toBe(LEARNING.start);
    expect(queue.size).toBe(0);
    clock.feed(true);
    for (let index = 0; index < 200; index++) advance(50);
    const running = draws.at(-1)?.frame ?? 0;
    expect(running).toBeGreaterThan(LEARNING.start + 500);
    expect(draws.every((draw, index) => draw.frame >= (draws[index - 1]?.frame ?? 0))).toBe(true);
    clock.pause(true);
    advance(1000);
    expect(draws.at(-1)?.frame).toBe(running);
    clock.pause(false);
    advance(1000);
    expect(draws.at(-1)?.frame).toBe(running);
    advance(50);
    expect(draws.at(-1)?.frame).toBe(running + 3);
    motion.matches = true;
    motion.dispatchEvent(new Event("change"));
    advance(50);
    expect(draws.at(-1)?.frame).toBe(running + 3);
    motion.matches = false;
    motion.dispatchEvent(new Event("change"));
    clock.finish(true);
    for (let index = 0; index < 20; index++) advance(50);
    expect(draws.at(-1)?.completion).toBe(LEARNING.completionFrames);
    expect(draws.at(-1)?.frame).toBeGreaterThan(running);
    expect(queue.size).toBe(0);
  } finally {
    clock.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("the ongoing stream stays populated and bounded beyond the original trailer shot", () => {
  let minimum = Infinity;
  let maximumEvents = 0;
  let lastId = 0;
  const arrivals = new Map<number, number>();
  for (let frame = LEARNING.start + 80; frame < LEARNING.start + 60 * 60; frame++) {
    const events = learningCards(frame);
    maximumEvents = Math.max(maximumEvents, events.length);
    const visible = events.filter((card) => (learningCardFrame(frame, card)?.opacity ?? 0) > 0.4);
    minimum = Math.min(minimum, visible.length);
    for (const card of visible) {
      arrivals.set(card.id, card.a);
      lastId = Math.max(lastId, card.id);
    }
  }
  expect(minimum).toBeGreaterThanOrEqual(2);
  expect(maximumEvents).toBeLessThanOrEqual(12);
  expect(lastId).toBeGreaterThan(100);
  const times = [...arrivals.values()];
  const intervals = times.slice(1).map((at, index) => at - (times[index] ?? at));
  expect(Math.max(...intervals) - Math.min(...intervals)).toBeGreaterThan(10);
  expect(learningCards(LEARNING.start + 60 * 60 * 24).length).toBeLessThanOrEqual(12);
});

test("stream cards retain the trailer's readable hold and cubic swallow arc", () => {
  // Independent coordinates from trailer-v12/src/v10/twinui10.tsx LearnCard.
  const card = { id: 0, a: 1294, at: 1387.52, side: -1 as const, y: 455 };
  expect(learningCardFrame(1293, card)).toBeNull();
  expect(learningCardFrame(1340, card)).toEqual({ x: 370, y: 455, scale: 1, opacity: 1, blur: 0 });
  const swallow = learningCardFrame(1380, card);
  if (!swallow) throw new Error("Missing card during absorption");
  expect(swallow.x).toBeCloseTo(457.83743000000055, 10);
  expect(swallow.y).toBeCloseTo(462.09206820349556, 10);
  expect(swallow.scale).toBeCloseTo(0.8630331599999991, 10);
  const absorbed = learningCardFrame(card.at, card);
  if (!absorbed) throw new Error("Missing card at absorption endpoint");
  expect(absorbed.x).toBe(960);
  expect(absorbed.y).toBe(730);
  expect(absorbed.scale).toBeCloseTo(0.08, 10);
  expect(absorbed.opacity).toBe(0);
  expect(learningCardFrame(1389, card)).toBeNull();
});

test("the production rig keeps its spring state, absorbs stream events and completes only explicitly", () => {
  const rig = new TwinRig();
  const sparse = new TwinRig();
  rig.set("learning", "calm");
  sparse.set("learning", "calm");
  let maxBendStep = 0;
  let previousBend = 0;
  for (let frame = LEARNING.start; frame <= LEARNING.start + 1800; frame++) {
    const pose = rig.frame(1 / 60, false, frame);
    const bend = (pose.uBend as number[])[0] ?? 0;
    maxBendStep = Math.max(maxBendStep, Math.abs(bend - previousBend));
    previousBend = bend;
    if (frame % 6 === 0) expect(sparse.frame(0.1, false, frame)).toEqual(pose);
  }
  const frame = LEARNING.start + 1800;
  const running = rig.frame(0, false, frame);
  expect(running.uT).toBe(frame / 60);
  expect(running.uSmile).toBeLessThan(0.9);
  expect(maxBendStep).toBeLessThan(0.05);
  expect(rig.frame(10, true, frame)).toEqual(running);

  const card = learningCards(frame).find((item) => item.at > frame);
  if (!card) throw new Error("Missing next absorption event");
  const gulp = rig.frame(0.5, false, card.at);
  expect((gulp.uRipple as number[])[3]).toBe(0);
  expect(gulp.uSquash).toBeLessThan(0.97);
  expect(gulp.uGlow).toBeGreaterThanOrEqual(0.55);
  expect(learningCardFrame(card.at, card)?.opacity).toBe(0);
  expect(Math.sign((gulp.uRipple as number[])[0] ?? 0)).toBe(card.side);

  const beforeComplete = rig.frame(0, false, card.at, 0);
  expect(beforeComplete.uBend).toEqual(gulp.uBend);
  const ready = rig.frame(0.5, false, card.at + 18, 18);
  expect(ready.uSmile).toBe(1.05);
  expect(ready.uLift).toBeGreaterThan(0);
  expect((ready.uArms as number[])[0]).toBeGreaterThan(0.7);
  expect((ready.uArms as number[])[1]).toBeGreaterThan(0.7);
  rig.set("idle", "calm");
  expect(rig.frame(0, true, frame).uT).toBe(0);
});
