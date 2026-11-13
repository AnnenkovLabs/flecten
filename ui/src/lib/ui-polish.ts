import { i18n } from "./i18n.svelte";
import { taskAge } from "./new-session";
import type { AgentRunResult, RunAction, TaskStatusKind, ThreadItem } from "./types";

export const COMPOSER_FOCUS_EVENT = "liquid:composer-focus";
export const MODEL_PICKER_EVENT = "liquid:model-picker";
export const TASK_RENAME_EVENT = "liquid:task-rename";
export const TASK_DELETE_EVENT = "liquid:task-delete";

export interface TaskRenameDetail {
  id: string;
  title: string;
}

export interface TaskDeleteDetail {
  id: string;
}

let composerFocusPending = false;

/**
 * Asks the composer for focus once the view has updated. Sending from the new session screen
 * swaps its composer for the thread one: the composer that mounts takes the request in
 * onMount, and only when none mounted does the one that stayed get the event. An instant
 * event would be taken by the outgoing composer and the focus would be lost.
 */
export function focusComposer(): void {
  composerFocusPending = true;
  if (typeof window === "undefined") return;
  setTimeout(() => {
    if (composerFocusPending) window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
  }, 0);
}

export function consumeComposerFocus(): boolean {
  if (!composerFocusPending) return false;
  composerFocusPending = false;
  return true;
}

export function requestTaskRename(id: string, title: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TaskRenameDetail>(TASK_RENAME_EVENT, { detail: { id, title } }),
  );
}

export function requestTaskDelete(id: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TaskDeleteDetail>(TASK_DELETE_EVENT, { detail: { id } }));
}

export type DraftMap = Record<string, string>;

export function updateDraft(map: DraftMap, taskId: string, text: string): DraftMap {
  if (!taskId) return map;
  if (text.length === 0) {
    if (!(taskId in map)) return map;
    const next = { ...map };
    delete next[taskId];
    return next;
  }
  if (map[taskId] === text) return map;
  return { ...map, [taskId]: text };
}

export function moveDraft(map: DraftMap, from: string, to: string): DraftMap {
  if (from === to) return map;
  const value = map[from];
  if (value === undefined) return map;
  const next = { ...map };
  delete next[from];
  next[to] = value;
  return next;
}

/** What the task list shows: live state first (permission, running, interrupted), then the result. */
export function taskStatus(
  stopReason: AgentRunResult["stopReason"] | undefined,
  state: { running: boolean; approvals: number; interrupted: boolean },
): TaskStatusKind {
  if (state.approvals > 0) return "waiting";
  if (state.running) return "working";
  if (state.interrupted) return "interrupted";
  switch (stopReason) {
    case "done":
    case "end":
      return "done";
    case "stopped":
    case "budget":
      return "stopped";
    case "error":
    case "max_turns":
      return "error";
    default:
      return "review";
  }
}

export function answerDisplayText(text: string, summary?: string): string {
  if (!summary) return text;
  return text.trim() === summary.trim() ? "" : text;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  return taskAge(iso, now);
}

export function absoluteTime(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: "long",
    timeStyle: "medium",
  }).format(new Date(time));
}

export function timeTitle(iso: string, now: Date = new Date()): string {
  const absolute = absoluteTime(iso);
  if (!absolute) return "";
  const relative = relativeTime(iso, now);
  return relative ? `${relative} · ${absolute}` : absolute;
}

export function itemSearchText(item: ThreadItem, tools?: ReadonlyMap<string, RunAction>): string {
  switch (item.kind) {
    case "message":
    case "answer":
    case "error":
      return item.text;
    case "notice":
      return [item.text, item.meta ?? ""].join("\n");
    case "approval":
      return [item.approval.tool, item.approval.target, item.approval.reason].join("\n");
    case "worker":
      return ["Worker", item.status, ...item.actions.map((action) => action.label)].join("\n");
    case "worker-tool":
      return tools?.get(item.reference)?.label ?? "Worker";
    case "run":
      return [
        item.summary.text,
        ...item.summary.list.map((action) => action.label),
        ...item.summary.turns.map((turn) => turn.reasoning),
      ]
        .filter((value) => value.length > 0)
        .join("\n");
  }
}

export function searchScore(text: string, query: string): number {
  const needle = query.trim().toLocaleLowerCase(i18n.locale);
  if (!needle) return 0;
  const haystack = text.toLocaleLowerCase(i18n.locale);

  let hits = 0;
  let cursor = 0;
  let index = haystack.indexOf(needle, cursor);
  while (index >= 0) {
    hits += 1;
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
  }
  if (hits === 0) return 0;

  let score = hits * 10;
  if (haystack === needle) score += 30;
  else if (haystack.startsWith(needle)) score += 15;
  if (haystack.includes(` ${needle}`) || haystack.includes(`\n${needle}`)) score += 5;
  if (haystack.endsWith(needle)) score += 2;
  return score;
}

export interface ThreadSearchHit {
  id: string;
  kind: ThreadItem["kind"];
  score: number;
}

export function searchThread(
  items: readonly ThreadItem[],
  query: string,
  tools?: ReadonlyMap<string, RunAction>,
): ThreadSearchHit[] {
  if (!query.trim()) return [];
  const hits: ThreadSearchHit[] = [];
  for (const item of items) {
    const score = searchScore(itemSearchText(item, tools), query);
    if (score > 0) hits.push({ id: item.id, kind: item.kind, score });
  }
  return hits;
}
