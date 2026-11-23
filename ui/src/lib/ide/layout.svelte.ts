import { z } from "zod";
import { appearance, IDE_LAYOUT_STORAGE_KEY, syncCodeFontSize } from "../appearance.svelte";

const Preferences = z.object({
  filesWidth: z.number().min(180).max(440),
  agentWidth: z.number().min(300).max(600),
  outputHeight: z.number().min(100).max(500),
  fontSize: z.number().min(11).max(22),
  tabSize: z.union([z.literal(2), z.literal(4)]),
  wrap: z.boolean(),
  minimap: z.boolean().default(true),
});

export class IdeLayout {
  #layout = $state({
    filesWidth: 240,
    agentWidth: 360,
    outputHeight: 220,
    tabSize: 2 as 2 | 4,
    wrap: false,
    minimap: true,
  });

  get values() {
    return { ...this.#layout, fontSize: appearance.codeFontSize };
  }

  restore(): void {
    try {
      const parsed = Preferences.safeParse(
        JSON.parse(localStorage.getItem(IDE_LAYOUT_STORAGE_KEY) ?? "null"),
      );
      if (parsed.success) {
        const { fontSize, ...rest } = parsed.data;
        this.#layout = rest;
        syncCodeFontSize(fontSize);
      }
    } catch {
      /* Preferences are optional. */
    }
  }

  set(patch: Partial<typeof this.values>): void {
    const parsed = Preferences.safeParse({ ...this.values, ...patch });
    if (!parsed.success) return;
    const { fontSize, ...rest } = parsed.data;
    this.#layout = rest;
    syncCodeFontSize(fontSize);
    try {
      localStorage.setItem(IDE_LAYOUT_STORAGE_KEY, JSON.stringify(parsed.data));
    } catch {
      /* Preferences are optional. */
    }
  }
}
