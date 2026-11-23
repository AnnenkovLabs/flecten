import type { SessionState } from "../../../../shared/session-state";
import { formatDuration } from "../agent";
import { i18n, t } from "../i18n.svelte";
import { formatModelName } from "../model-name";
import { fallbackReason } from "../run-errors";
import { nextId, nowIso } from "../run-helpers";
import type { AgentJob, AgentRunResult, NoticeItem, ThreadItem } from "../types";

/** Reconciles pending approvals in the thread against the canonical SessionState snapshot. */
export function syncThreadApprovals(
  items: ThreadItem[],
  state: SessionState,
  push: (item: ThreadItem) => void,
): void {
  const waiting = new Map(state.approvals.map((approval) => [approval.id, approval]));
  const resolutions = new Map((state.approvalResolutions ?? []).map((entry) => [entry.id, entry]));
  for (const item of items) {
    if (item.kind !== "approval" || item.owner === "worker") continue;
    if (waiting.delete(item.approval.id)) continue;
    const resolved = resolutions.get(item.approval.id);
    item.state = resolved ? resolved.choice : item.state === "pending" ? "deny" : item.state;
    if (resolved) item.by = resolved.by;
    else if (item.state === "deny" && !item.by) item.by = "aborted";
  }
  for (const approval of waiting.values()) {
    push({
      kind: "approval",
      id: nextId("apr"),
      sessionId: state.sessionId,
      approval,
      state: "pending",
    });
  }
}

/** Notice cards of the thread: a run resumed, interrupted or stopped by its budget, a job done. */

export function fallbackNotice(event: { provider: string; model: string; reason: string }) {
  const name = formatModelName(event.model);
  const why = fallbackReason(event.reason);
  return {
    label: t("Fallback model {0} responded", [name]),
    meta: event.provider,
    details: t("{0}{1}: request sent to {2}, model {3}.", [
      why.charAt(0).toLocaleUpperCase(i18n.locale),
      why.slice(1),
      event.provider,
      event.model,
    ]),
    toast: t("Fallback model {0} is responding: {1}", [name, why]),
  };
}

export function resumedNotice(): NoticeItem {
  return {
    kind: "notice",
    id: nextId("note"),
    icon: "refresh",
    text: t("Resuming the task after the core restarted"),
    meta: t(
      "History, plan, and files are intact; the model checks the current state before acting",
    ),
    tone: "info",
    at: nowIso(),
  };
}

export function interruptedNotice(reason: string, at: number): NoticeItem {
  return {
    kind: "notice",
    id: nextId("note"),
    icon: "stop",
    text: t("Run interrupted"),
    meta: reason,
    tone: "warn",
    action: "continue",
    at: new Date(at).toISOString(),
  };
}

export function budgetNotice(result: AgentRunResult): NoticeItem {
  return {
    kind: "notice",
    id: nextId("note"),
    icon: "stop",
    text: t("Stopped at the run budget limit"),
    meta: result.summary,
    tone: "warn",
    action: "continue",
    at: nowIso(),
  };
}

function jobOutcome(job: AgentJob): string {
  if (job.status === "stopped") return t("stopped");
  if (job.status === "failed") return job.error ?? t("failed to start");
  if (job.timedOut) return t("timed out");
  return job.exitCode === 0 ? t("done") : t("exit code {0}", [job.exitCode ?? "?"]);
}

export function jobNotice(job: AgentJob): NoticeItem {
  const ok = job.status === "exited" && job.exitCode === 0 && !job.timedOut;
  return {
    kind: "notice",
    id: nextId("note"),
    icon: "terminal",
    text: t("Background command: {0}", [job.command]),
    meta: `${jobOutcome(job)} · ${formatDuration(job.durationMs)}`,
    tone: ok ? "info" : "warn",
    at: nowIso(),
  };
}

export function interruptedToast(
  interruptedCount: number,
  resumedCount: number,
): {
  kind: "show" | "error";
  text: string;
} {
  const waiting = interruptedCount - resumedCount;
  if (resumedCount > 0) {
    const rest = waiting > 0 ? t(", waiting for you: {0}", [waiting]) : "";
    return { kind: "show", text: t("Resuming interrupted tasks: {0}{1}", [resumedCount, rest]) };
  }
  return {
    kind: "error",
    text: t("Interrupted tasks: {0}. Open a task and click Continue", [interruptedCount]),
  };
}

export function threadError(text: string, code: string): Extract<ThreadItem, { kind: "error" }> {
  return { kind: "error", id: nextId("err"), text, code, at: nowIso() };
}

export function interruptedResult(sessionId: string): AgentRunResult {
  return {
    sessionId,
    pass: false,
    stopReason: "stopped",
    summary: "",
    turns: 0,
    usage: { input: 0, output: 0, cached: 0 },
  };
}
