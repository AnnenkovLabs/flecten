import { z } from "zod";

const Preferences = z.object({
  filesWidth: z.number().min(180).max(440),
  agentWidth: z.number().min(300).max(600),
  outputHeight: z.number().min(100).max(500),
  fontSize: z.number().min(11).max(22),
  tabSize: z.union([z.literal(2), z.literal(4)]),
  wrap: z.boolean(),
});
const KEY = "flecten.ide.layout";
export class IdeLayout {
  values = $state({
    filesWidth: 240,
    agentWidth: 360,
    outputHeight: 220,
    fontSize: 13,
    tabSize: 2 as 2 | 4,
    wrap: false,
  });
  restore(): void {
    try {
      const parsed = Preferences.safeParse(JSON.parse(localStorage.getItem(KEY) ?? "null"));
      if (parsed.success) this.values = parsed.data;
    } catch {
      /* Preferences are optional. */
    }
  }
  set(patch: Partial<typeof this.values>): void {
    const parsed = Preferences.safeParse({ ...this.values, ...patch });
    if (!parsed.success) return;
    this.values = parsed.data;
    try {
      localStorage.setItem(KEY, JSON.stringify(parsed.data));
    } catch {
      /* Preferences are optional. */
    }
  }
}
