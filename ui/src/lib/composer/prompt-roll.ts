import { prefersReducedMotion } from "../motion";
import type { HistoryDirection } from "./prompt-history";

export interface RollMotionFrame {
  y: number;
  z: number;
  rotateX: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  blurY: number;
}

export interface RollSnapshot {
  clone: HTMLElement;
  scrollTop: number;
  fromHeight: number;
}

interface RollTargets {
  stage: HTMLElement;
  host: HTMLElement;
  editor: () => HTMLElement | null;
  blurIn: () => SVGFEGaussianBlurElement | null;
  blurOut: () => SVGFEGaussianBlurElement | null;
  blurInId: string;
  blurOutId: string;
}

const IN_DURATION_MS = 165;
const OUT_DURATION_MS = 115;
const RAPID_IN_DURATION_MS = 125;
const RAPID_OUT_DURATION_MS = 90;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Pure 3D vertical roll + directional vertical motion blur kinematics for prompt history switching.
 * Anchored at the left text axis so motion travels strictly vertically without bowing sideways.
 */
export function rollMotionState(
  progress: number,
  direction: HistoryDirection,
  phase: "in" | "out",
  boost = 1,
): RollMotionFrame {
  const p = clamp01(progress);
  const dir = direction === "up" ? 1 : -1;
  if (phase === "in") {
    const ease = 1 - (1 - p) ** 2.8;
    const rem = 1 - ease;
    const velocity = (1 - p) ** 2 * boost;
    return {
      y: -dir * 26 * rem,
      z: -18 * rem,
      rotateX: dir * 16 * rem,
      scaleX: 1,
      scaleY: 1 + 0.16 * velocity,
      opacity: Math.min(1, p / 0.22),
      blurY: 18 * velocity,
    };
  }
  const accel = p ** 1.5;
  return {
    y: dir * 24 * accel,
    z: -16 * accel,
    rotateX: -dir * 14 * accel,
    scaleX: 1,
    scaleY: 1 + 0.18 * p ** 0.85 * boost,
    opacity: Math.max(0, 1 - p ** 1.1),
    blurY: (3 + 17 * p ** 0.7) * boost,
  };
}

function applyFrame(node: HTMLElement, frame: RollMotionFrame): void {
  node.style.transform = `perspective(900px) translate3d(0, ${frame.y.toFixed(2)}px, ${frame.z.toFixed(2)}px) rotateX(${frame.rotateX.toFixed(2)}deg) scale3d(${frame.scaleX.toFixed(4)}, ${frame.scaleY.toFixed(4)}, 1)`;
  node.style.opacity = frame.opacity.toFixed(3);
}

/** Frame-locked 3D + SVG directional vertical motion blur transitions for the prompt editor. */
export class PromptRoller {
  #raf = 0;
  #ghost: HTMLElement | null = null;
  #active = false;

  constructor(private readonly targets: RollTargets) {}

  prepareSnapshot(): RollSnapshot | null {
    if (prefersReducedMotion()) return null;
    const editorEl = this.targets.editor();
    if (!editorEl) return null;
    const fromHeight = this.targets.host.getBoundingClientRect().height;
    const clone = editorEl.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.removeAttribute("contenteditable");
    clone.removeAttribute("role");
    clone.removeAttribute("tabindex");
    for (const attr of [...clone.attributes]) {
      if (attr.name.startsWith("aria-")) clone.removeAttribute(attr.name);
    }
    clone.setAttribute("aria-hidden", "true");
    clone.classList.add("prompt-roll-ghost");
    clone.style.transform = "";
    clone.style.opacity = "";
    clone.style.filter = "";
    clone.style.willChange = "transform, opacity, filter";
    return { clone, scrollTop: editorEl.scrollTop, fromHeight };
  }

  play(direction: HistoryDirection, snapshot: RollSnapshot | null): void {
    const rapid = this.#active;
    this.cancel();
    if (prefersReducedMotion() || !snapshot) return;
    const editorEl = this.targets.editor();
    if (!editorEl) return;

    const toHeight = this.targets.host.getBoundingClientRect().height;
    const animateHeight = Math.abs(toHeight - snapshot.fromHeight) > 1;
    const inDuration = rapid ? RAPID_IN_DURATION_MS : IN_DURATION_MS;
    const outDuration = rapid ? RAPID_OUT_DURATION_MS : OUT_DURATION_MS;
    const boost = rapid ? 1.2 : 1;

    this.#active = true;
    this.#ghost = snapshot.clone;
    this.targets.stage.classList.add("is-rolling");
    this.targets.stage.appendChild(snapshot.clone);
    snapshot.clone.scrollTop = snapshot.scrollTop;

    const blurIn = this.targets.blurIn();
    const blurOut = this.targets.blurOut();
    editorEl.style.willChange = "transform, opacity, filter";
    editorEl.style.transformOrigin = "0% 50%";
    snapshot.clone.style.transformOrigin = "0% 50%";
    if (blurIn) editorEl.style.filter = `url(#${this.targets.blurInId})`;
    if (blurOut) snapshot.clone.style.filter = `url(#${this.targets.blurOutId})`;
    if (animateHeight) this.targets.host.style.height = `${snapshot.fromHeight}px`;

    const startedAt = performance.now();
    const step = (now: number): void => {
      const elapsed = Math.max(0, now - startedAt);
      const pIn = clamp01(elapsed / inDuration);
      const pOut = clamp01(elapsed / outDuration);

      const inFrame = rollMotionState(pIn, direction, "in", boost);
      applyFrame(editorEl, inFrame);
      blurIn?.setAttribute("stdDeviation", `0 ${inFrame.blurY.toFixed(2)}`);

      if (this.#ghost) {
        if (pOut >= 1) {
          this.#ghost.remove();
          this.#ghost = null;
          blurOut?.setAttribute("stdDeviation", "0 0");
        } else {
          const outFrame = rollMotionState(pOut, direction, "out", boost);
          applyFrame(this.#ghost, outFrame);
          blurOut?.setAttribute("stdDeviation", `0 ${outFrame.blurY.toFixed(2)}`);
        }
      }

      if (animateHeight) {
        const ease = 1 - (1 - pIn) ** 2.8;
        const height = snapshot.fromHeight + (toHeight - snapshot.fromHeight) * ease;
        this.targets.host.style.height = `${height.toFixed(2)}px`;
      }

      if (pIn >= 1) {
        this.cancel();
        return;
      }
      this.#raf = requestAnimationFrame(step);
    };

    step(startedAt);
  }

  cancel(): void {
    if (this.#raf) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
    this.#active = false;
    if (this.#ghost) {
      this.#ghost.remove();
      this.#ghost = null;
    }
    this.targets.stage.classList.remove("is-rolling");
    this.targets.host.style.height = "";
    const editorEl = this.targets.editor();
    if (editorEl) {
      editorEl.style.transform = "";
      editorEl.style.transformOrigin = "";
      editorEl.style.opacity = "";
      editorEl.style.filter = "";
      editorEl.style.willChange = "";
    }
    this.targets.blurIn()?.setAttribute("stdDeviation", "0 0");
    this.targets.blurOut()?.setAttribute("stdDeviation", "0 0");
  }
}
