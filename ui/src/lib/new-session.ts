import { i18n, t } from "./i18n.svelte";
import type { IconName, TaskStatusKind } from "./types";

export interface NewSessionProject {
  id: string;
  name: string;
  path?: string;
}

export interface NewSessionTask {
  id: string;
  title: string;
  project: string;
  status: TaskStatusKind;
  updatedAt: string;
  messageCount?: number;
  tokens?: number;
}

export const RECENT_STATUS: Record<
  TaskStatusKind,
  { label: string; icon: IconName; needsAttention: boolean }
> = {
  working: {
    get label() {
      return t("In progress");
    },
    icon: "refresh",
    needsAttention: false,
  },
  waiting: {
    get label() {
      return t("Awaiting a decision");
    },
    icon: "tasks",
    needsAttention: true,
  },
  review: {
    get label() {
      return t("In review");
    },
    icon: "search",
    needsAttention: true,
  },
  done: {
    get label() {
      return t("Done");
    },
    icon: "check",
    needsAttention: false,
  },
  error: {
    get label() {
      return t("Error");
    },
    icon: "x",
    needsAttention: true,
  },
  interrupted: {
    get label() {
      return t("Interrupted");
    },
    icon: "stop",
    needsAttention: true,
  },
  stopped: {
    get label() {
      return t("Stopped");
    },
    icon: "stop",
    needsAttention: false,
  },
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export function taskAge(iso: string, now: Date = new Date()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";

  const delta = now.getTime() - time;
  if (delta < MINUTE) return t("now");
  if (delta < HOUR) return t("{0} min", [Math.floor(delta / MINUTE)]);
  if (delta < DAY) return t("{0} hr", [Math.floor(delta / HOUR)]);
  if (delta < 7 * DAY) return t("{0} d", [Math.floor(delta / DAY)]);

  const date = new Date(time);
  return new Intl.DateTimeFormat(i18n.locale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const }),
  }).format(date);
}

function updatedAt(task: NewSessionTask): number {
  const time = Date.parse(task.updatedAt);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

export function filterRecent(
  tasks: readonly NewSessionTask[],
  query = "",
  limit = 6,
): NewSessionTask[] {
  const needle = query.trim().toLowerCase();
  const filtered = tasks.filter((task) => {
    if (!needle) return true;
    return task.title.toLowerCase().includes(needle) || task.project.toLowerCase().includes(needle);
  });

  const sorted = [...filtered].sort((left, right) => {
    const leftTime = updatedAt(left);
    const rightTime = updatedAt(right);
    if (leftTime === rightTime) return 0;
    return leftTime < rightTime ? 1 : -1;
  });

  return sorted.slice(0, Math.max(0, Math.floor(limit)));
}
