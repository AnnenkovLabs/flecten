import { z } from "zod";
import type { ThreadItem } from "../types";
import { snapshotSchema } from "./prompt-clipboard";
import type { PromptSnapshot } from "./prompt-document";

export type HistoryDirection = "up" | "down";

export interface HistoryStep {
  snapshot: PromptSnapshot;
  direction: HistoryDirection;
}

const HISTORY_PREFIX = "flecten.composer-history.v1:";
export const MAX_PROMPT_HISTORY = 100;
const historySchema = z.array(snapshotSchema).max(MAX_PROMPT_HISTORY);

function cloneSnapshot(snapshot: PromptSnapshot): PromptSnapshot {
  return {
    text: snapshot.text,
    mentions: snapshot.mentions.map((mention) => ({
      ...mention,
      ...(mention.context ? { context: { ...mention.context } } : {}),
    })),
  };
}

/** Extracts chronological user-authored prompts from the active thread. */
export function userPrompts(items: readonly ThreadItem[]): string[] {
  const prompts: string[] = [];
  for (const item of items) {
    if (item.kind === "message" && item.actor !== "twin" && item.text.trim().length > 0) {
      prompts.push(item.text);
    }
  }
  return prompts;
}

export function readPromptHistory(
  project: string,
  storage: Storage | undefined = globalThis.localStorage,
): PromptSnapshot[] {
  try {
    const raw = storage?.getItem(HISTORY_PREFIX + project) ?? null;
    if (raw === null) return [];
    const parsed = historySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.map(cloneSnapshot) : [];
  } catch {
    return [];
  }
}

export function recordPromptHistory(
  project: string,
  snapshot: PromptSnapshot,
  storage: Storage | undefined = globalThis.localStorage,
): PromptSnapshot[] {
  if (snapshot.text.trim().length === 0) return readPromptHistory(project, storage);
  const existing = readPromptHistory(project, storage).filter(
    (entry) => entry.text !== snapshot.text,
  );
  const next = [...existing, cloneSnapshot(snapshot)].slice(-MAX_PROMPT_HISTORY);
  try {
    storage?.setItem(HISTORY_PREFIX + project, JSON.stringify(next));
  } catch {
    // History recall degrades gracefully if profile storage is full or unavailable.
  }
  return next;
}

/**
 * Merges workspace-persisted prompt snapshots with the current chat's user messages.
 * The active chat's latest messages always sit at the newest end, reusing saved mentions
 * whenever exact prompt text matches.
 */
export function mergePromptHistory(
  persisted: readonly PromptSnapshot[],
  threadPrompts: readonly string[],
): PromptSnapshot[] {
  const byText = new Map<string, PromptSnapshot>();
  const ordered: PromptSnapshot[] = [];
  const pushUnique = (entry: PromptSnapshot): void => {
    if (entry.text.trim().length === 0) return;
    const prev = ordered.findIndex((item) => item.text === entry.text);
    if (prev >= 0) ordered.splice(prev, 1);
    const cloned = cloneSnapshot(entry);
    byText.set(cloned.text, cloned);
    ordered.push(cloned);
  };
  for (const entry of persisted) pushUnique(entry);
  for (const text of threadPrompts) {
    if (text.trim().length === 0) continue;
    const stored = byText.get(text);
    pushUnique(stored ?? { text, mentions: [] });
  }
  return ordered.slice(-MAX_PROMPT_HISTORY);
}

/**
 * Stateful Up/Down prompt history cursor.
 * While `pinned` is true (consecutive Up/Down presses), stepping crosses multiline prompts
 * without trapping the caret on interior lines.
 */
export class PromptHistoryNavigator {
  #index: number | null = null;
  #stash: PromptSnapshot | null = null;
  #pinned = false;

  get active(): boolean {
    return this.#index !== null;
  }

  get pinned(): boolean {
    return this.#pinned;
  }

  canStep(
    direction: HistoryDirection,
    entries: readonly PromptSnapshot[],
    atBoundary: boolean,
  ): boolean {
    if (entries.length === 0) return false;
    if (direction === "up") {
      if (this.#index === 0) return false;
      return this.#pinned || atBoundary;
    }
    if (this.#index === null) return false;
    return this.#pinned || atBoundary;
  }

  step(
    direction: HistoryDirection,
    entries: readonly PromptSnapshot[],
    current: PromptSnapshot,
  ): HistoryStep | null {
    if (entries.length === 0) return null;
    if (direction === "up") {
      if (this.#index === null) {
        this.#stash = cloneSnapshot(current);
        this.#index = entries.length - 1;
      } else {
        const clamped = Math.min(this.#index, entries.length - 1);
        if (clamped <= 0) return null;
        this.#index = clamped - 1;
      }
      this.#pinned = true;
      const entry = entries[this.#index];
      return entry ? { snapshot: cloneSnapshot(entry), direction } : null;
    }
    if (this.#index === null) return null;
    if (this.#index < entries.length - 1) {
      this.#index += 1;
      this.#pinned = true;
      const entry = entries[this.#index];
      return entry ? { snapshot: cloneSnapshot(entry), direction } : null;
    }
    const restored = this.#stash ? cloneSnapshot(this.#stash) : { text: "", mentions: [] };
    this.reset();
    return { snapshot: restored, direction };
  }

  unpin(): void {
    this.#pinned = false;
  }

  reset(): void {
    this.#index = null;
    this.#stash = null;
    this.#pinned = false;
  }
}
