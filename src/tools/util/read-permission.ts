import { realpath } from "node:fs/promises";
import type { ToolContext } from "../types";

export type SearchContext = Pick<ToolContext, "cwd" | "signal"> &
  Partial<Pick<ToolContext, "permissions" | "sandbox" | "sessionId">>;

/** Search consent covers traversal, but never overrides a denied descendant or a protected file. */
export async function canReadSearchPath(
  context: SearchContext,
  path: string,
  tool: string,
): Promise<boolean> {
  if (context.signal.aborted) return false;
  const sandbox = await context.sandbox?.checkRead(path);
  if (sandbox && !sandbox.allowed) return false;
  let canonical: string;
  try {
    canonical = await realpath(path);
  } catch {
    return false;
  }
  for (const resource of new Set([path, canonical])) {
    const decision = context.permissions?.check({
      action: "read",
      tool,
      path: resource,
      cwd: context.cwd,
      safety: "bounded",
    });
    if (decision?.policy === "deny" || decision?.humanOnly) return false;
  }
  return true;
}
