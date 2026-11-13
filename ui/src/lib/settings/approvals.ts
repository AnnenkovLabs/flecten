// Answers to pending approvals from the settings window.
import { requestAgent, sendAgent } from "../desktop";
import type { ApprovalDecision, ApprovalView } from "../permissions";
import { adoptRules } from "../settings-utils";
import type { AgentEvent, AgentInfo, HarnessSettings } from "../types";

type Response = Extract<AgentEvent, { type: "response" }>;

export interface ApprovalHost {
  info: AgentInfo | null;
  settings: HarnessSettings | null;
  baseline: HarnessSettings | null;
  error: string;
}

export function approvalViews(info: AgentInfo | null): ApprovalView[] {
  const views = new Map<string, ApprovalView>();
  for (const entry of info?.sessions ?? []) {
    for (const approval of entry.state?.approvals ?? [])
      views.set(approval.id, {
        id: approval.id,
        tool: approval.tool,
        action: approval.action,
        target: approval.target,
        reason: approval.reason,
        requestedAt: approval.createdAt,
        expiresAt: approval.expiresAt,
        sessionId: entry.sessionId,
        ...(approval.humanOnly ? { humanOnly: true } : {}),
        ...(approval.cwd ? { cwd: approval.cwd } : {}),
        ...(approval.risks ? { risks: approval.risks } : {}),
        ...(approval.grantLabel ? { grantLabel: approval.grantLabel } : {}),
        ...(approval.arguments ? { arguments: approval.arguments } : {}),
      });
  }
  for (const approval of info?.approvals ?? []) {
    if (views.has(approval.id)) continue;
    views.set(approval.id, {
      id: approval.id,
      tool: approval.request.tool,
      action: approval.request.action,
      target: approval.request.target ?? approval.request.path ?? approval.request.cwd,
      reason: approval.reason ?? approval.request.reason ?? "",
      requestedAt: approval.createdAt,
      cwd: approval.request.cwd,
      ...(approval.request.sessionId ? { sessionId: approval.request.sessionId } : {}),
      ...(approval.request.risks ? { risks: approval.request.risks } : {}),
    });
  }
  return [...views.values()];
}

function failed(host: ApprovalHost, error: unknown): void {
  host.error = error instanceof Error ? error.message : String(error);
}

/** The waiting call itself goes on or stops; «Всегда» also saves a precise rule in the core. */
export async function respondApproval(
  host: ApprovalHost,
  id: string,
  decision: ApprovalDecision,
  feedback?: string,
): Promise<void> {
  try {
    await requestAgent(
      { type: "approval.respond", id, decision, ...(feedback ? { feedback } : {}) },
      10_000,
    );
    const remaining = host.info?.approvals?.filter((entry) => entry.id !== id);
    host.info = host.info ? { ...host.info, ...(remaining ? { approvals: remaining } : {}) } : null;
    sendAgent({ type: "status" });
    if (decision !== "allow_always" || !host.settings) return;
    const response = await requestAgent<Response>({ type: "settings.get" });
    adoptRules(host.settings, response.settings?.config);
    adoptRules(host.baseline, response.settings?.config);
  } catch (error) {
    failed(host, error);
  }
}

export async function answerAllApprovals(
  host: ApprovalHost,
  type: "approval.allowAll" | "approval.denyAll",
  reviewedIds?: string[],
): Promise<void> {
  const ids = reviewedIds ?? approvalViews(host.info).map((approval) => approval.id);
  if (ids.length === 0) return;
  try {
    await requestAgent({ type, ids }, 10_000);
    host.info = host.info
      ? {
          ...host.info,
          approvals: host.info.approvals?.filter((entry) => !ids.includes(entry.id)) ?? [],
        }
      : null;
    sendAgent({ type: "status" });
  } catch (error) {
    failed(host, error);
  }
}
