/** Notices above the composer: the stacking rules, kept apart from timers and Svelte state. */

export type ToastTone = "info" | "error";

export interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

/** Notices on screen at once. */
export const TOAST_LIMIT = 3;

const INFO_MS = 2_400;
const INFO_MAX_MS = 6_000;
const MS_PER_CHAR = 40;

/** Longer messages get more reading time. */
export function infoDuration(text: string): number {
  return Math.min(INFO_MAX_MS, INFO_MS + text.length * MS_PER_CHAR);
}

export function toastDuration(item: Pick<ToastItem, "text" | "tone">): number {
  return item.tone === "error" ? Math.max(6_000, infoDuration(item.text)) : infoDuration(item.text);
}

export interface ToastPush {
  items: ToastItem[];
  /** The notice now on screen for this text: the new one, or the same one moved to the end. */
  shown: ToastItem;
  /** Notices pushed out by the limit. */
  dropped: number[];
}

/**
 * Adds a notice at the end, next to the composer. The same text and tone again moves the
 * notice instead of stacking a copy. Past the limit the oldest info notice gives way first,
 * an error only when the others are errors too.
 */
export function pushToast(
  items: readonly ToastItem[],
  item: ToastItem,
  limit: number = TOAST_LIMIT,
): ToastPush {
  const shown = items.find((entry) => entry.text === item.text && entry.tone === item.tone) ?? item;
  const next = [...items.filter((entry) => entry !== shown), shown];
  const dropped: number[] = [];
  while (next.length > limit) {
    const older = next.slice(0, -1);
    const drop = older.find((entry) => entry.tone === "info") ?? older[0];
    if (!drop) break;
    next.splice(next.indexOf(drop), 1);
    dropped.push(drop.id);
  }
  return { items: next, shown, dropped };
}
