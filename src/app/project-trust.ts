import { PermissionEngine } from "../security/permissions";
import type { PermissionRequest } from "../security/types";
import { type ToolContext, ToolFailure } from "../tools/types";

/** Use the normal cancellable approval channel, so project trust is visible in the current chat. */
export async function requestProjectTrust(
  context: ToolContext,
  trusted: () => boolean,
  accept: () => Promise<unknown>,
): Promise<void> {
  if (trusted()) return;
  if (!context.approvals)
    throw new ToolFailure("permission", "Project trust requires an interactive approval.");
  const request: PermissionRequest = {
    action: "skill",
    tool: "module",
    target: context.cwd,
    cwd: context.cwd,
    sessionId: context.approvalSessionId ?? context.sessionId,
    ...(context.permissionActor ? { actor: context.permissionActor } : {}),
    args: { operation: "trust_project" },
    risks: [
      {
        id: "project-trust",
        label: "Trust this project",
        detail:
          "Configured modules, MCP servers and hooks can run code with your account's permissions. Approval lasts until the project is reopened.",
      },
    ],
  };
  const authority = new PermissionEngine(
    { rules: [{ action: "skill", tool: "module", policy: "ask", checkpoint: true }] },
    context.permissions,
  );
  const decision = authority.decide(request);
  if (!decision.approvalId || decision.policy === "deny")
    throw new ToolFailure("permission", decision.reason);
  const outcome = await context.approvals.wait(
    {
      id: decision.approvalId,
      request,
      reason: decision.reason,
      humanOnly: true,
      ...(context.callId ? { callId: context.callId } : {}),
    },
    context.signal,
    authority,
  );
  context.signal.throwIfAborted();
  if (outcome.choice === "deny" || outcome.by !== "user")
    throw new ToolFailure("permission", `Project trust was not accepted (${outcome.by}).`);
  if (authority.check(request).policy === "deny")
    throw new ToolFailure(
      "permission",
      "Permission changed while project trust was awaiting approval.",
    );
  if (!trusted()) await accept();
}
