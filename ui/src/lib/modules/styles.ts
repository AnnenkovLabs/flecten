import { z } from "zod";
import type { ModuleSurface } from "../../../../shared/modules";
import { HARNESS_TOKENS } from "../markdown/tokens";

const overlays = new Map<string, HTMLStyleElement>();
export const MODULE_THEME_EVENT = "flecten.module.theme";

export function moduleThemeTokens(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    [...Object.keys(HARNESS_TOKENS), "color-scheme"].map((name) => [
      name,
      computed.getPropertyValue(name),
    ]),
  );
}
export function notifyModuleTheme(): void {
  window.dispatchEvent(new Event(MODULE_THEME_EVENT));
}
/** Ordinary CSS, owned by the caller's revision and removed by the same recovery lifecycle. */
export function setModuleStyles(surface: ModuleSurface, value: unknown): void {
  const css = z.string().max(256_000).parse(value);
  const key = `${surface.module}:${surface.revision}`;
  let style = overlays.get(key);
  if (!style) {
    style = document.createElement("style");
    style.dataset.moduleOverlay = surface.module;
    overlays.set(key, style);
  }
  style.textContent = css;
  document.head.append(style);
  notifyModuleTheme();
}
export function retainModuleStyles(keys: ReadonlySet<string>): void {
  for (const [key, style] of overlays)
    if (!keys.has(key)) {
      style.remove();
      overlays.delete(key);
    }
  notifyModuleTheme();
}
