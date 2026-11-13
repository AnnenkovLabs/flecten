import { z } from "zod";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../settings/sections";
import type { TabId } from "../types";

export type SummaryDestination =
  | { kind: "settings"; section: SettingsSectionId }
  | { kind: "panel"; panel: "thread" | TabId }
  | { kind: "file"; path: string; line?: number }
  | { kind: "models" };

const panels = {
  thread: true,
  changes: true,
  history: true,
  terminal: true,
  worker: true,
} satisfies Record<"thread" | TabId, true>;
const fileSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(4000)
      .refine((path) => !path.includes("\0")),
    line: z.coerce.number().int().min(1).max(1_000_000).optional(),
  })
  .strict();

/** Only UI destinations are accepted. File access still uses the existing bounded viewer. */
export function parseSummaryDestination(value: string): SummaryDestination | null {
  if (value.length > 4000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "flecten:" || url.username || url.password || url.port || url.hash)
      return null;
    const parameters = [...url.searchParams];
    if (url.hostname === "file") {
      if (url.pathname && url.pathname !== "/") return null;
      if (new Set(parameters.map(([key]) => key)).size !== parameters.length) return null;
      const file = fileSchema.safeParse(Object.fromEntries(parameters));
      if (!file.success) return null;
      return {
        kind: "file",
        path: file.data.path,
        ...(file.data.line === undefined ? {} : { line: file.data.line }),
      };
    }
    if (parameters.length > 0) return null;
    if (url.hostname === "settings") {
      const section = SETTINGS_SECTIONS.find((entry) => url.pathname === `/${entry.id}`);
      return section ? { kind: "settings", section: section.id } : null;
    }
    if (url.hostname === "panel") {
      const panel = url.pathname.slice(1);
      return Object.hasOwn(panels, panel)
        ? { kind: "panel", panel: panel as "thread" | TabId }
        : null;
    }
    if (url.hostname === "models" && (url.pathname === "" || url.pathname === "/"))
      return { kind: "models" };
  } catch {
    /* A malformed link has no action. */
  }
  return null;
}
