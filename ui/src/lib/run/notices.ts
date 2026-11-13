import { formatDuration } from "../agent";
import { t } from "../i18n.svelte";
import { nextId, nowIso } from "../run-helpers";
import type { AgentJob, AgentRunResult, NoticeItem } from "../types";

/** Notice cards of the thread: a run resumed, interrupted or stopped by its budget, a job done. */

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
