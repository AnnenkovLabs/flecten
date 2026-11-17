import { z } from "zod";

/** Full verification remains valid for old retirement; new plans preserve derived data by rename. */
export const ContentScopeSchema = z.enum(["full", "durable"]);
export type ContentScope = z.infer<typeof ContentScopeSchema>;

export function rebuildable(path: string): boolean {
  const [top] = path.split("/");
  return top === "cache" || top === "diagnostics" || top === "shadow" || path === "sidecar.lock";
}
