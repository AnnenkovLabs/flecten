import { i18n, t } from "../i18n.svelte";
import type { Attachment, QueuedMessage, SendMode } from "./types";

export interface QueueSnapshot {
  items: readonly QueuedMessage[];
}

export type QueueEvent =
  | { type: "add"; item: QueuedMessage }
  | { type: "edit"; id: string; text: string }
  | { type: "remove"; id: string }
  | { type: "begin"; id: string }
  | { type: "sent"; id: string }
  | { type: "cancel"; id: string };

export function emptyQueue(): QueueSnapshot {
  return { items: [] };
}

export function queueTransitions(state: QueueSnapshot, event: QueueEvent): QueueSnapshot {
  switch (event.type) {
    case "add": {
      if (event.item.text.trim().length === 0) return state;
      if (state.items.some((item) => item.id === event.item.id)) return state;
      return { items: [...state.items, { ...event.item, state: "pending" }] };
    }
    case "edit": {
      if (event.text.trim().length === 0) return state;

      let changed = false;
      const items = state.items.map((item) => {
        if (item.id !== event.id || item.state !== "pending" || item.text === event.text) {
          return item;
        }
        changed = true;
        return { ...item, text: event.text };
      });

      return changed ? { items } : state;
    }
    case "remove": {
      const items = state.items.filter((item) => item.id !== event.id || item.state !== "pending");
      return items.length === state.items.length ? state : { items };
    }
    case "begin": {
      let changed = false;
      const items = state.items.map((item) => {
        if (item.id !== event.id || item.state !== "pending") return item;
        changed = true;
        return { ...item, state: "sending" as const };
      });

      return changed ? { items } : state;
    }
    case "sent": {
      const items = state.items.filter((item) => item.id !== event.id || item.state !== "sending");
      return items.length === state.items.length ? state : { items };
    }
    case "cancel": {
      const items = state.items.filter((item) => item.id !== event.id || item.state !== "pending");
      return items.length === state.items.length ? state : { items };
    }
  }
}

export interface SendDraft {
  text: string;
  attachments: readonly Attachment[];
  mode: SendMode;
  running: boolean;
}

export function canSend(draft: SendDraft): boolean {
  const hasContent = draft.text.trim().length > 0 || draft.attachments.length > 0;
  if (!hasContent) return false;
  return draft.mode === "queue" || draft.running;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) bytes = 0;

  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const number = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: digits }).format(
    value,
  );
  const label = t(BYTE_UNITS[unit] ?? BYTE_UNITS[0]);

  return `${number}\u00A0${label}`;
}
