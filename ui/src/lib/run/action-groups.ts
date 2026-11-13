import { formatDuration } from "../agent";
import { formatNumber } from "../format";
import { t } from "../i18n.svelte";
import type { RunAction } from "../types";

/** Tools that only look around the project: a streak of them reads as one step. */
const EXPLORE_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "glob"]);

/** Shortest streak shown as a group; a single call stays a plain row. */
const MIN_GROUP = 2;

export interface ActionGroup {
  kind: "group";
  /** The first call's id: stable while the streak grows during a live run. */
  id: string;
  label: string;
  duration: string;
  failed: boolean;
  running: boolean;
  actions: RunAction[];
}

export type ActionEntry = { kind: "action"; action: RunAction } | ActionGroup;

function isExplore(action: RunAction): boolean {
  return action.tool !== undefined && EXPLORE_TOOLS.has(action.tool);
}

function groupLabel(actions: readonly RunAction[]): string {
  const reads = actions.filter((action) => action.tool === "read").length;
  const searches = actions.length - reads;
  const parts: string[] = [];
  if (reads > 0) parts.push(t("Files read: {0}", [formatNumber(reads)]));
  if (searches > 0) parts.push(t("Searches: {0}", [formatNumber(searches)]));
  return parts.join(" · ");
}

function groupOf(actions: RunAction[]): ActionGroup {
  const running = actions.some((action) => action.running === true);
  const elapsed = actions.reduce((sum, action) => sum + (action.detail?.durationMs ?? 0), 0);
  return {
    kind: "group",
    id: `group-${actions[0]?.id ?? "empty"}`,
    get label() {
      return groupLabel(actions);
    },
    duration: running ? "…" : elapsed > 0 ? formatDuration(elapsed) : "",
    failed: actions.some((action) => action.failed === true),
    running,
    actions,
  };
}

/**
 * Folds consecutive read, grep and glob calls into one entry; every call inside still opens
 * on its own. Any other call, a note or an edit ends the streak.
 */
export function groupActions(actions: readonly RunAction[]): ActionEntry[] {
  const entries: ActionEntry[] = [];
  let streak: RunAction[] = [];
  const flush = (): void => {
    if (streak.length >= MIN_GROUP) entries.push(groupOf(streak));
    else for (const action of streak) entries.push({ kind: "action", action });
    streak = [];
  };
  for (const action of actions) {
    if (isExplore(action)) {
      streak.push(action);
      continue;
    }
    flush();
    entries.push({ kind: "action", action });
  }
  flush();
  return entries;
}
