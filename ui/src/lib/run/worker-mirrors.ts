import { toolReferences } from "../markdown/tool-references";
import type { RunAction, ThreadItem } from "../types";

export function workerMirrors(items: readonly ThreadItem[]): ReadonlyMap<string, RunAction> {
  return new Map(
    items.flatMap((item) =>
      item.kind === "worker" ? item.actions.map((action) => [action.id, action] as const) : [],
    ),
  );
}

/** Each call is visible without a model reference; explicit prose references take its place. */
export function conversationItems(
  items: readonly ThreadItem[],
  tools: ReadonlyMap<string, RunAction>,
): ThreadItem[] {
  const known = new Set(tools.keys());
  const referenced = new Set(
    items.flatMap((item) =>
      item.kind === "answer"
        ? toolReferences(item.text, known).flatMap((part) =>
            part.kind === "tool" ? [part.id] : [],
          )
        : [],
    ),
  );
  return items.filter(
    (item) =>
      item.kind !== "worker" && (item.kind !== "worker-tool" || !referenced.has(item.reference)),
  );
}
