import type { AgentEvent } from "./agent-protocol";
import { clearComposerDraft } from "./composer/drafts.svelte";
import { requestAgent } from "./desktop";
import { t } from "./i18n.svelte";
import { mergedSessions, sortedSessions } from "./run/sessions";
import { toast } from "./toast.svelte";
import type { AgentSessionSummary } from "./types";
import {
  focusComposer,
  TASK_DELETE_EVENT,
  TASK_RENAME_EVENT,
  type TaskDeleteDetail,
  type TaskRenameDetail,
} from "./ui-polish";

const TASK_FORK_EVENT = "liquid:task-fork";

type Response = Extract<AgentEvent, { type: "response" }>;

/** The part of the run store that task list actions need. */
export interface TaskHost {
  sessions: AgentSessionSummary[];
  activeTask: string;
  title: string;
  isRunning(id: string): boolean;
  newTask(): void;
  selectTask(id: string): Promise<void>;
}

/** Rename, delete and fork requests that task rows send as window events. */
export function listenTaskEvents(host: TaskHost): () => void {
  const onRename = (event: Event): void => {
    void renameTask(host, (event as CustomEvent<TaskRenameDetail>).detail);
  };
  const onDelete = (event: Event): void => {
    void deleteTask(host, (event as CustomEvent<TaskDeleteDetail>).detail);
  };
  const onFork = (event: Event): void => {
    const detail = (event as CustomEvent<{ id?: unknown }>).detail;
    if (detail && typeof detail.id === "string") void forkTask(host, detail.id);
  };
  window.addEventListener(TASK_RENAME_EVENT, onRename);
  window.addEventListener(TASK_DELETE_EVENT, onDelete);
  window.addEventListener(TASK_FORK_EVENT, onFork);
  return () => {
    window.removeEventListener(TASK_RENAME_EVENT, onRename);
    window.removeEventListener(TASK_DELETE_EVENT, onDelete);
    window.removeEventListener(TASK_FORK_EVENT, onFork);
  };
}

/** Only the latest list or search answer lands; a slow older one is dropped. */
let listSequence = 0;

export async function refreshTasks(host: TaskHost): Promise<void> {
  const ticket = ++listSequence;
  try {
    const response = await requestAgent<Response>({ type: "sessions.list" });
    if (ticket === listSequence)
      host.sessions = mergedSessions(host.sessions, response.sessions ?? []);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

export async function searchTasks(host: TaskHost, query: string): Promise<void> {
  const value = query.trim();
  if (!value) {
    await refreshTasks(host);
    return;
  }
  const ticket = ++listSequence;
  try {
    const response = await requestAgent<Response>({ type: "sessions.search", query: value });
    if (ticket === listSequence) host.sessions = sortedSessions(response.sessions ?? []);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

export async function renameTask(
  host: TaskHost,
  detail: TaskRenameDetail | undefined,
): Promise<void> {
  if (!detail || typeof detail.id !== "string" || typeof detail.title !== "string") return;
  const title = detail.title.trim().slice(0, 72);
  if (!title) return;
  const previous = host.sessions.find((session) => session.id === detail.id);
  host.sessions = host.sessions.map((session) =>
    session.id === detail.id ? { ...session, title } : session,
  );
  if (host.activeTask === detail.id) host.title = title;
  try {
    const response = await requestAgent<Response>({
      type: "sessions.rename",
      id: detail.id,
      title,
    });
    const session = response.session;
    if (session) {
      host.sessions = host.sessions.map((entry) =>
        entry.id === detail.id ? { ...entry, ...session } : entry,
      );
    }
  } catch (error) {
    if (previous) {
      host.sessions = host.sessions.map((entry) => (entry.id === detail.id ? previous : entry));
    }
    if (host.activeTask === detail.id) host.title = previous?.title ?? host.title;
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

export async function deleteTask(
  host: TaskHost,
  detail: TaskDeleteDetail | undefined,
): Promise<void> {
  if (!detail || typeof detail.id !== "string") return;
  if (host.isRunning(detail.id)) {
    toast.show(t("The task is still running. Stop it first"));
    return;
  }
  try {
    await requestAgent<Response>({
      type: "sessions.delete",
      id: detail.id,
      confirm: true,
    });
    host.sessions = host.sessions.filter((session) => session.id !== detail.id);
    if (detail.id === host.activeTask) host.newTask();
    clearComposerDraft(detail.id);
    focusComposer();
    toast.show(t("Task moved to trash"));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

export async function forkTask(host: TaskHost, id: string): Promise<void> {
  if (!id) return;
  try {
    const response = await requestAgent<Response>({
      type: "sessions.fork",
      id,
    });
    const session = response.session;
    if (!session) throw new Error(t("The server did not return a new task"));
    host.sessions = [session, ...host.sessions.filter((entry) => entry.id !== session.id)];
    await host.selectTask(session.id);
    toast.show(t("Task copied"));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}
