import { z } from "zod";
import { trackUiAction } from "./telemetry";

export const INTERFACE_SCALE = { min: 75, max: 125, step: 5, default: 100 } as const;
const KEY = "flecten.interfaceScale";
const Scale = z
  .number()
  .int()
  .min(INTERFACE_SCALE.min)
  .max(INTERFACE_SCALE.max)
  .multipleOf(INTERFACE_SCALE.step);

function parseScale(value: string | null): number {
  try {
    const parsed = Scale.safeParse(JSON.parse(value ?? "null"));
    return parsed.success ? parsed.data : INTERFACE_SCALE.default;
  } catch {
    return INTERFACE_SCALE.default;
  }
}

function savedScale(): number {
  try {
    return parseScale(globalThis.localStorage?.getItem(KEY) ?? null);
  } catch {
    return INTERFACE_SCALE.default;
  }
}

export const interfaceScale = $state({ percent: savedScale() });

export function setInterfaceScale(value: unknown): void {
  const parsed = Scale.safeParse(value);
  if (!parsed.success) return;
  interfaceScale.percent = parsed.data;
  window.desktop?.setInterfaceScale?.(parsed.data);
  trackUiAction("scale_changed");
  try {
    localStorage.setItem(KEY, String(parsed.data));
  } catch {
    // A blocked profile store still allows scaling the current window.
  }
}

export function initializeInterfaceScale(): () => void {
  window.desktop?.setInterfaceScale?.(interfaceScale.percent);
  const sync = (event: StorageEvent): void => {
    if (event.key !== KEY && event.key !== null) return;
    interfaceScale.percent = parseScale(event.newValue);
    window.desktop?.setInterfaceScale?.(interfaceScale.percent);
  };
  window.addEventListener("storage", sync);
  return () => window.removeEventListener("storage", sync);
}
