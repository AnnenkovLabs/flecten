import { type TwinEmotion, TwinRig, type TwinState } from "./pose";
import { createTwinRenderer } from "./renderer";

/** One visible canvas, with no model calls or work scheduled outside its lifetime. */
export function createTwinScene(
  canvas: HTMLCanvasElement,
  interactive: boolean,
  fallback: (shown: boolean) => void,
) {
  const rig = new TwinRig();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let renderer: ReturnType<typeof createTwinRenderer> | undefined;
  let visible = false;
  let paused = false;
  let lost = false;
  let disposed = false;
  let frame = 0;
  let last = 0;
  let count = 0;
  let quality = 1;
  let width = canvas.clientWidth;
  const still = () => paused || motion.matches || !interactive;
  const shown = () => visible && !document.hidden && width > 0 && !lost && !disposed;

  function stop(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    canvas.dataset.active = "false";
  }

  function draw(now: number): void {
    frame = 0;
    if (!shown()) return stop();
    if (last && now - last < 1000 / 24) {
      frame = requestAnimationFrame(draw);
      return;
    }
    const elapsed = last ? now - last : 1000 / 24;
    if (last && elapsed > 100 && quality > 0.5) quality = Math.max(0.5, quality * 0.9);
    last = now;
    try {
      renderer ??= createTwinRenderer(canvas);
      const pose = rig.frame(elapsed / 1000, still());
      // ponytail: adaptive 192..512px framebuffer at 24fps; profile GPU timing before raising it.
      const resolution = Math.max(
        Math.min(64, width),
        Math.min(512, width * Math.min(devicePixelRatio || 1, 1.5)) * quality,
      );
      renderer.render(pose, resolution);
      canvas.dataset.renderer = "webgl";
      canvas.dataset.frame = String(++count);
      canvas.dataset.yaw = String(pose.uYaw);
      canvas.dataset.look = String(pose.uLook);
      fallback(false);
    } catch {
      renderer?.dispose();
      renderer = undefined;
      lost = true;
      canvas.dataset.renderer = "fallback";
      fallback(true);
      return stop();
    }
    const animate = !still() || (!paused && !motion.matches && rig.settling);
    canvas.dataset.active = String(animate);
    if (animate) frame = requestAnimationFrame(draw);
  }

  function wake(): void {
    if (!shown()) return stop();
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function visibility(): void {
    if (!shown()) stop();
    else wake();
  }

  function contextLost(event: Event): void {
    event.preventDefault();
    lost = true;
    canvas.dataset.renderer = "fallback";
    fallback(true);
    stop();
  }

  function contextRestored(): void {
    renderer?.dispose();
    renderer = undefined;
    lost = false;
    wake();
  }

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    visibility();
  });
  const resize = new ResizeObserver(([entry]) => {
    width = entry?.contentRect.width ?? 0;
    wake();
  });
  intersection.observe(canvas);
  resize.observe(canvas);
  document.addEventListener("visibilitychange", visibility);
  motion.addEventListener("change", visibility);
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  canvas.dataset.renderer = "pending";
  canvas.dataset.active = "false";

  let drag: { id: number; x: number; distance: number } | undefined;
  return {
    set(state: TwinState, emotion: TwinEmotion): void {
      rig.set(state, emotion);
      canvas.dataset.emotion = emotion;
      canvas.dataset.state = state;
      wake();
    },
    pause(value: boolean): void {
      paused = value;
      stop();
      wake();
    },
    point(event: PointerEvent): void {
      const rect = canvas.getBoundingClientRect();
      rig.look(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      );
      if (drag?.id === event.pointerId) {
        const dx = event.clientX - drag.x;
        drag.distance += Math.abs(dx);
        drag.x = event.clientX;
        rig.turn((dx / Math.max(1, rect.width)) * Math.PI * 2);
      }
      wake();
    },
    down(event: PointerEvent): void {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, distance: 0 };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    up(event: PointerEvent): void {
      if (!drag || drag.id !== event.pointerId) return;
      if (drag.distance < 6) rig.greet();
      drag = undefined;
      wake();
    },
    leave(): void {
      if (!drag) rig.look(0, 0);
      wake();
    },
    cancel(): void {
      drag = undefined;
      rig.look(0, 0);
      wake();
    },
    key(event: KeyboardEvent): void {
      switch (event.key) {
        case "ArrowLeft":
          rig.turn(-0.25);
          break;
        case "ArrowRight":
          rig.turn(0.25);
          break;
        case "ArrowUp":
          rig.look(0, 0.7);
          break;
        case "ArrowDown":
          rig.look(0, -0.7);
          break;
        case "Home":
          rig.reset();
          break;
        case " ":
        case "Enter":
          rig.greet();
          break;
        default:
          return;
      }
      event.preventDefault();
      wake();
    },
    dispose(): void {
      disposed = true;
      stop();
      intersection.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", visibility);
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      renderer?.dispose();
    },
  };
}
