import { newId } from "../util/ids";
import { grantLabel, matchesPermissionRule, permissionRequestKey } from "./permission-request-key";
import type {
  ApprovalChoice,
  ApprovalDecision,
  PendingApproval,
  PermissionDecision,
  PermissionEngineOptions,
  PermissionPolicy,
  PermissionRequest,
  PermissionRule,
} from "./types";

const ORDER: Record<PermissionPolicy, number> = { deny: 3, ask: 2, allow: 1, auto: 0 };

export class PermissionEngine {
  private rules: PermissionRule[];
  private destructive: PermissionPolicy;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly decisions = new Map<string, ApprovalDecision>();
  private readonly sessionGrants = new Map<string, Set<string>>();
  private readonly now: () => number;
  private readonly onRemember: PermissionEngineOptions["onRemember"];
  private readonly parent: PermissionEngine | undefined;
  private readonly saving = new Map<string, AbortController>();
  private version = 0;
  get revision(): string {
    return `${this.version}:${this.parent?.revision ?? ""}`;
  }

  constructor(options: PermissionEngineOptions = {}, parent?: PermissionEngine) {
    this.rules = structuredClone(options.rules ?? []);
    this.destructive = options.destructive ?? "ask";
    this.now = options.now ?? Date.now;
    this.onRemember = options.onRemember;
    this.parent = parent;
  }

  /** Security changes apply to the next action in an already running session. */
  replaceRules(options: Pick<PermissionEngineOptions, "rules" | "destructive">): void {
    for (const controller of this.saving.values())
      controller.abort(new Error("Permission policy changed while saving the grant"));
    this.rules = structuredClone(options.rules ?? []);
    this.destructive = options.destructive ?? "ask";
    this.sessionGrants.clear();
    this.version += 1;
  }

  check(request: PermissionRequest): PermissionDecision {
    return this.evaluate(request, false);
  }
  decide(request: PermissionRequest): PermissionDecision {
    return this.evaluate(request, true);
  }

  private evaluate(request: PermissionRequest, createApproval: boolean): PermissionDecision {
    const inherited = this.parent?.check(request);
    if (inherited?.policy === "deny")
      return { policy: "deny", reason: `Parent permission: ${inherited.reason}` };
    const paths = request.paths?.length ? request.paths : [request.path];
    const actions = paths.map((path) => this.actionPolicy(request, path));
    const denied = actions.find((entry) => entry.policy === "deny");
    if (denied) return denied;
    const risks = (request.risks ?? []).map((risk) => ({
      risk,
      ...this.riskPolicy(request, risk.id, paths),
    }));
    const blocked = risks.find((entry) => entry.policy === "deny");
    if (blocked)
      return {
        policy: "deny",
        reason: `${blocked.risk.label}: запрещено правилом. ${blocked.risk.detail}`,
      };
    const action = actions.reduce(
      (strict, entry) => (ORDER[entry.policy] > ORDER[strict.policy] ? entry : strict),
      { policy: "auto", reason: "Разрешено автоматически." } as PermissionDecision,
    );
    const key = permissionRequestKey(request);
    const granted =
      request.sessionId !== undefined && this.sessionGrants.get(request.sessionId)?.has(key);
    const askedRisks = risks.filter((entry) => entry.policy === "ask").map((entry) => entry.risk);
    const humanOnly =
      inherited?.humanOnly === true ||
      actions.some((entry) => entry.humanOnly) ||
      risks.some((entry) => entry.humanOnly);
    if (granted && inherited?.policy !== "ask" && !humanOnly)
      return { policy: "allow", reason: "Точное действие разрешено пользователем для этого чата." };
    const needsAction = action.policy === "ask" || inherited?.policy === "ask";
    if (!needsAction && askedRisks.length === 0) return action;
    const asks = [
      ...actions.filter((entry) => entry.policy === "ask"),
      ...(inherited?.policy === "ask" ? [inherited] : []),
    ];
    const metadata = {
      ...(humanOnly ? { humanOnly: true } : {}),
      ...(!humanOnly &&
      askedRisks.length === 0 &&
      asks.length > 0 &&
      asks.every((entry) => entry.review === true)
        ? { review: true }
        : {}),
    };
    const reason = [
      needsAction
        ? inherited?.policy === "ask"
          ? `Parent permission: ${inherited.reason}`
          : action.reason
        : "",
      ...askedRisks.map((risk) => `${risk.label}: ${risk.detail}`),
    ]
      .filter(Boolean)
      .join(" ");
    if (!createApproval) return { policy: "ask", reason, ...metadata };
    const approval: PendingApproval = {
      id: newId("approval"),
      createdAt: this.now(),
      request: structuredClone(request),
      reason,
      askedAction: needsAction,
      askedRisks: askedRisks.map((risk) => risk.id),
      ...(humanOnly ? { humanOnly: true } : {}),
    };
    this.pendingApprovals.set(approval.id, approval);
    return { policy: "ask", reason, approvalId: approval.id, ...metadata };
  }

  private actionPolicy(request: PermissionRequest, path?: string): PermissionDecision {
    const matches = this.rules.filter(
      (rule) => rule.risk === undefined && matchesPermissionRule(rule, request, path),
    );
    const denied = matches.find((rule) => rule.policy === "deny");
    if (denied) return { policy: "deny", reason: this.explain(denied, request) };
    const checkpoint = matches.find((rule) => rule.policy === "ask" && rule.checkpoint);
    if (checkpoint)
      return { policy: "ask", reason: this.explain(checkpoint, request), humanOnly: true };
    matches.sort(
      (a, b) =>
        this.specificity(b) - this.specificity(a) ||
        (b.pathPrefix?.length ?? 0) - (a.pathPrefix?.length ?? 0) ||
        ORDER[b.policy] - ORDER[a.policy],
    );
    const rule = matches[0];
    if (!rule)
      return {
        policy: "ask",
        reason: `${request.tool}: нет подходящего правила, нужно подтверждение.`,
      };
    if (rule.policy === "auto" && request.safety !== "bounded")
      return {
        policy: "ask",
        reason: `${request.tool}: непрозрачное действие требует независимой проверки или подтверждения пользователя.`,
        review: true,
      };
    return { policy: rule.policy, reason: this.explain(rule, request) };
  }

  private specificity(rule: PermissionRule): number {
    return (rule.requestKey ? 8 : 0) + (rule.pathPrefix ? 2 : 0) + (rule.tool ? 1 : 0);
  }

  private riskPolicy(
    request: PermissionRequest,
    risk: string,
    paths: (string | undefined)[],
  ): Pick<PermissionDecision, "policy" | "humanOnly"> {
    const policies = paths.map((path) => {
      const matching = this.rules.filter(
        (rule) => rule.risk === risk && matchesPermissionRule(rule, request, path),
      );
      if (matching.some((rule) => rule.policy === "deny")) return { policy: "deny" as const };
      if (matching.some((rule) => rule.policy === "ask" && rule.checkpoint))
        return { policy: "ask" as const, humanOnly: true };
      matching.sort(
        (a, b) => this.specificity(b) - this.specificity(a) || ORDER[b.policy] - ORDER[a.policy],
      );
      return { policy: matching[0]?.policy ?? this.destructive };
    });
    return {
      policy: policies.reduce<PermissionPolicy>(
        (a, b) => (ORDER[b.policy] > ORDER[a] ? b.policy : a),
        "auto",
      ),
      ...(policies.some((entry) => entry.humanOnly) ? { humanOnly: true } : {}),
    };
  }

  pending(): PendingApproval[] {
    return structuredClone([...this.pendingApprovals.values()]);
  }

  cancel(id: string): void {
    this.saving.get(id)?.abort(new Error("Permission approval was cancelled"));
    this.pendingApprovals.delete(id);
    this.decisions.delete(id);
  }

  approve(id: string, choice: ApprovalChoice, feedback?: string): ApprovalDecision | undefined {
    const approval = this.pendingApprovals.get(id);
    if (!approval) return undefined;
    this.pendingApprovals.delete(id);
    const current = this.check(approval.request);
    if (current.policy === "deny") choice = "deny";
    else if (
      (approval.humanOnly || current.humanOnly) &&
      (choice === "allow_session" || choice === "allow_always")
    )
      choice = "allow_once";
    const decision: ApprovalDecision = {
      id,
      request: structuredClone(approval.request),
      choice,
      createdAt: approval.createdAt,
      resolvedAt: this.now(),
      stale: false,
    };
    if (feedback !== undefined) decision.feedback = feedback;
    if (choice === "allow_session" && approval.request.sessionId) {
      this.grantSession(approval.request);
    }
    if (choice === "allow_always") {
      const rule: PermissionRule = {
        action: approval.request.action,
        tool: approval.request.tool,
        requestKey: permissionRequestKey(approval.request),
        target: grantLabel(approval.request),
        cwd: approval.request.cwd,
        policy: "allow",
        note: "Разрешено пользователем: точное действие",
      };
      const rules = [rule, ...(approval.askedRisks ?? []).map((risk) => ({ ...rule, risk }))];
      // Without a persistence port the pure engine is synchronous (tests and embedded callers).
      if (!this.onRemember && !this.parent) this.rules.push(...rules);
      else decision.persistence = this.saveRules(id, rules, new AbortController());
    }
    this.decisions.set(id, decision);
    return decision;
  }

  private grantSession(request: PermissionRequest): void {
    if (!request.sessionId) return;
    this.parent?.grantSession(request);
    const grants = this.sessionGrants.get(request.sessionId) ?? new Set<string>();
    grants.add(permissionRequestKey(request));
    this.sessionGrants.set(request.sessionId, grants);
  }

  private async saveRules(
    id: string,
    rules: PermissionRule[],
    controller: AbortController,
  ): Promise<void> {
    this.saving.set(id, controller);
    const revision = this.revision;
    try {
      const additions = rules.filter(
        (rule) =>
          !this.rules.some(
            (known) =>
              known.requestKey === rule.requestKey &&
              known.risk === rule.risk &&
              known.policy === rule.policy,
          ),
      );
      if (this.parent) await this.parent.saveRules(id, rules, controller);
      else if (additions.length)
        await this.onRemember?.(structuredClone(additions), controller.signal);
      controller.signal.throwIfAborted();
      if (revision !== this.revision)
        throw new Error("Permission policy changed while saving the grant");
      this.rules.push(...additions);
    } finally {
      if (this.saving.get(id) === controller) this.saving.delete(id);
    }
  }

  approveAll(choice: ApprovalChoice = "allow_once"): ApprovalDecision[] {
    return [...this.pendingApprovals.keys()].flatMap((id) => this.approve(id, choice) ?? []);
  }
  denyAll(): ApprovalDecision[] {
    return this.approveAll("deny");
  }

  expireOlderThan(ms: number): PendingApproval[] {
    const cutoff = this.now() - ms;
    const expired: PendingApproval[] = [];
    for (const approval of this.pendingApprovals.values()) {
      if (approval.createdAt > cutoff) continue;
      this.pendingApprovals.delete(approval.id);
      this.decisions.set(approval.id, {
        id: approval.id,
        request: approval.request,
        choice: "deny",
        createdAt: approval.createdAt,
        resolvedAt: this.now(),
        stale: true,
      });
      expired.push(approval);
    }
    for (const [id, decision] of this.decisions)
      if (decision.resolvedAt <= cutoff) this.decisions.set(id, { ...decision, stale: true });
    return expired;
  }

  consumeDecision(id: string): ApprovalDecision | undefined {
    const decision = this.decisions.get(id);
    this.decisions.delete(id);
    return decision;
  }

  private explain(rule: PermissionRule, request: PermissionRequest): string {
    const policy = {
      deny: "запрещено правилом",
      ask: "требуется подтверждение",
      auto: "разрешено автоматически по правилу",
      allow: "разрешено правилом",
    }[rule.policy];
    return `${request.tool}, действие "${request.action}": ${policy}.${rule.note ? ` Причина: ${rule.note}.` : ""}`;
  }
}
