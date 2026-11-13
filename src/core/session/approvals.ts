import { grantLabel } from "../../security/permission-request-key";
import type { PermissionEngine } from "../../security/permissions";
import type {
  ApprovalChoice,
  ApprovalDecision,
  ApprovalGate,
  ApprovalOutcome,
  ApprovalPrompt,
} from "../../security/types";
import type { Event, PendingApprovalView, SessionId } from "../types";

type Waiter = (outcome: ApprovalOutcome) => void;

/**
 * Tool calls that need a permission wait here for the user's answer. The UI gets
 * `approval.requested`; the answer, a timeout or a stop resolves the call and emits
 * `approval.resolved`, so "allow once" really lets that call run.
 */
export class ApprovalWaiters {
  readonly #waiting = new Map<
    string,
    { finish: Waiter; approval: PendingApprovalView; authority: PermissionEngine | undefined }
  >();
  readonly #emit: (event: Event) => void;
  readonly #resolved: Array<{ id: string; choice: ApprovalChoice; by: ApprovalOutcome["by"] }> = [];
  #permissions: () => PermissionEngine | undefined;
  #timeoutMs: () => number;

  constructor(options: {
    emit: (event: Event) => void;
    permissions: () => PermissionEngine | undefined;
    timeoutMs: () => number;
  }) {
    this.#emit = options.emit;
    this.#permissions = options.permissions;
    this.#timeoutMs = options.timeoutMs;
  }

  gate(sessionId: SessionId): ApprovalGate {
    return {
      wait: (prompt, signal, authority) => this.#wait(sessionId, prompt, signal, authority),
    };
  }

  /** Applies the user's answer; returns undefined when the approval is unknown or already answered. */
  async respond(
    id: string,
    choice: ApprovalChoice,
    feedback?: string,
  ): Promise<ApprovalDecision | undefined> {
    const waiting = this.#waiting.get(id);
    if (!waiting) return undefined;
    if (Date.now() >= waiting.approval.expiresAt) {
      waiting.authority?.cancel(id);
      this.#settle(id, { choice: "deny", by: "timeout" });
      return undefined;
    }
    const permissions = waiting.authority;
    const decision = permissions?.approve(id, choice, feedback);
    if (decision === undefined) return undefined;
    try {
      await decision.persistence;
    } catch (error) {
      permissions?.consumeDecision(id);
      // A timeout or cancellation already published the authoritative outcome while I/O finished.
      if (this.#waiting.get(id) !== waiting) return undefined;
      this.#settle(id, { choice: "deny", by: "persistence" });
      throw new Error(
        `Permission was not saved; the call was denied. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    permissions?.consumeDecision(id);
    if (this.#waiting.get(id) !== waiting) return undefined;
    const denied = choice !== "deny" && permissions?.check(decision.request).policy === "deny";
    this.#settle(
      id,
      denied
        ? { choice: "deny", by: "policy" }
        : { choice: decision.choice, by: "user", ...(feedback !== undefined ? { feedback } : {}) },
    );
    const { persistence: _persistence, ...result } = decision;
    return denied ? { ...result, choice: "deny" } : result;
  }

  pending(): PendingApprovalView[] {
    return structuredClone([...this.#waiting.values()].map(({ approval }) => approval));
  }

  pendingIds(): string[] {
    return [...this.#waiting.keys()];
  }

  resolutions(): Array<{ id: string; choice: ApprovalChoice; by: ApprovalOutcome["by"] }> {
    return structuredClone(this.#resolved);
  }

  #settle(id: string, outcome: ApprovalOutcome): void {
    const waiter = this.#waiting.get(id);
    if (!waiter) return;
    this.#waiting.delete(id);
    waiter.finish(outcome);
  }

  #wait(
    sessionId: SessionId,
    prompt: ApprovalPrompt,
    signal: AbortSignal,
    authority: PermissionEngine | undefined = this.#permissions(),
  ): Promise<ApprovalOutcome> {
    if (prompt.request.sessionId !== undefined && prompt.request.sessionId !== sessionId) {
      authority?.cancel(prompt.id);
      return Promise.resolve({ choice: "deny", by: "policy" });
    }
    const timeoutMs = this.#timeoutMs();
    const createdAt = Date.now();
    return new Promise<ApprovalOutcome>((resolve) => {
      const finish = (outcome: ApprovalOutcome): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        this.#resolved.push({ id: prompt.id, choice: outcome.choice, by: outcome.by });
        if (this.#resolved.length > 100) this.#resolved.shift();
        this.#emit({
          type: "approval.resolved",
          sessionId,
          id: prompt.id,
          choice: outcome.choice,
          by: outcome.by,
          ...(outcome.by === "user" && outcome.feedback !== undefined
            ? { feedback: outcome.feedback }
            : {}),
        });
        resolve(outcome);
      };
      const expire = (by: "timeout" | "aborted"): void => {
        if (!this.#waiting.has(prompt.id)) return;
        this.#waiting.delete(prompt.id);
        const permissions = authority;
        permissions?.cancel(prompt.id);
        finish({ choice: "deny", by });
      };
      const abort = (): void => expire("aborted");
      const timer = setTimeout(() => expire("timeout"), timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      const approval: PendingApprovalView = {
        id: prompt.id,
        action: prompt.request.action,
        tool: prompt.request.tool,
        target: prompt.request.target ?? "",
        reason: prompt.reason,
        ...(prompt.humanOnly || authority?.check(prompt.request).humanOnly
          ? { humanOnly: true }
          : {}),
        ...(prompt.request.risks && prompt.request.risks.length > 0
          ? { risks: prompt.request.risks }
          : {}),
        ...(prompt.callId ? { callId: prompt.callId } : {}),
        createdAt,
        expiresAt: createdAt + timeoutMs,
        cwd: prompt.request.cwd,
        ...(prompt.request.paths ? { paths: prompt.request.paths } : {}),
        ...(prompt.request.reason ? { requestReason: prompt.request.reason } : {}),
        grantLabel: grantLabel(prompt.request),
        arguments: Object.entries(prompt.request.args ?? {}).map(([name, value]) => ({
          name,
          value: typeof value === "string" ? value : JSON.stringify(value),
        })),
        ...(prompt.request.actor ? { actor: prompt.request.actor } : {}),
      };
      this.#waiting.set(prompt.id, { finish, approval, authority });
      this.#emit({ type: "approval.requested", sessionId, approval });
      if (signal.aborted) abort();
    });
  }
}
