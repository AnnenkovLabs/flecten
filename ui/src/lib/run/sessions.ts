import { t } from "../i18n.svelte";
import type { AgentRunResult, AgentSessionSummary, Project, TaskStatusKind } from "../types";
import { relativeTime } from "../ui-polish";

export function projectTasks(
  sessions: readonly AgentSessionSummary[],
  name: string,
  status: (session: AgentSessionSummary) => TaskStatusKind,
): Project[] {
  const tasks = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    status: status(session),
    age: relativeTime(session.updatedAt),
    updatedAt: session.updatedAt,
    ...(session.lastPrompt === undefined ? {} : { lastPrompt: session.lastPrompt }),
    ...(session.messageCount === undefined ? {} : { messageCount: session.messageCount }),
  }));
  return [{ id: "current", name, age: "", current: true, tasks }];
}

/** The task list as runs start and finish, before the next sessions.list catches up. */

function firstLine(text: string): string {
  return text.split("\n")[0]?.slice(0, 72) ?? "";
}

function byRecent(list: AgentSessionSummary[]): AgentSessionSummary[] {
  return list.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function startedSessions(
  list: readonly AgentSessionSummary[],
  id: string,
  prompt: string,
): AgentSessionSummary[] {
  const existing = list.find((session) => session.id === id);
  const { stopReason: _stopReason, ...rest } = existing ?? {};
  const summary: AgentSessionSummary = {
    ...rest,
    id,
    title: existing?.title || firstLine(prompt) || id,
    updatedAt: new Date().toISOString(),
  };
  return [summary, ...list.filter((session) => session.id !== id)];
}

export function finishedSessions(
  list: readonly AgentSessionSummary[],
  id: string,
  stopReason: AgentRunResult["stopReason"],
): AgentSessionSummary[] {
  const existing = list.find((session) => session.id === id);
  const summary: AgentSessionSummary = {
    ...(existing ?? { title: id }),
    id,
    updatedAt: new Date().toISOString(),
    stopReason,
  };
  return existing
    ? list.map((session) => (session.id === id ? summary : session))
    : [summary, ...list];
}

/** Sessions from the core, keeping local entries the core does not list yet. */
export function mergedSessions(
  current: readonly AgentSessionSummary[],
  fetched: readonly AgentSessionSummary[],
): AgentSessionSummary[] {
  const merged = new Map(current.map((session) => [session.id, session]));
  for (const session of fetched) merged.set(session.id, { ...merged.get(session.id), ...session });
  return byRecent([...merged.values()]);
}

export function sortedSessions(list: readonly AgentSessionSummary[]): AgentSessionSummary[] {
  return byRecent([...list]);
}

export function finishedLabel(stopReason: AgentRunResult["stopReason"]): string {
  switch (stopReason) {
    case "done":
    case "end":
      return t("done");
    case "stopped":
      return t("stopped");
    case "budget":
      return t("stopped at the budget limit");
    case "max_turns":
      return t("turn limit reached");
    case "error":
      return t("error");
  }
}
