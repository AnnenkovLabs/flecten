import type { PermissionEngine } from "./permissions";

export type PermissionAction =
  | "read"
  | "write"
  | "shell"
  | "network"
  | "mcp"
  | "skill"
  | "external_path";

export type PermissionPolicy = "deny" | "auto" | "ask" | "allow";

export type PermissionRule = {
  action: PermissionAction;
  tool?: string;
  pathPrefix?: string;
  /** Destructive operation id (`git-push-force`): the rule decides only that operation. */
  risk?: string;
  /** An exact, canonical request. Never a shell prefix or a wildcard. */
  requestKey?: string;
  target?: string;
  cwd?: string;
  policy: PermissionPolicy;
  /** An ask checkpoint requires a fresh human answer for every matching operation. */
  checkpoint?: boolean;
  note?: string;
};

/** A destructive operation inside a shell command that no checkpoint can undo. */
export type PermissionRisk = {
  id: string;
  label: string;
  detail: string;
};

export type PermissionRequest = {
  action: PermissionAction;
  tool: string;
  target?: string;
  path?: string;
  cwd: string;
  args?: Record<string, unknown>;
  reason?: string;
  risks?: PermissionRisk[];
  sessionId?: string;
  /** Set by the trusted tool descriptor, never by model arguments. */
  safety?: "bounded" | "unbounded";
  paths?: string[];
  actor?: string;
};

export type PermissionDecision = {
  policy: PermissionPolicy;
  reason: string;
  approvalId?: string;
  /** Only this ask may be passed to an independent approval reviewer. */
  review?: boolean;
  humanOnly?: boolean;
};

export type PermissionEngineOptions = {
  rules?: PermissionRule[];
  /** Policy for destructive operations no rule names; `ask` by default. */
  destructive?: PermissionPolicy;
  now?: () => number;
  /** Publish an entire exact grant atomically; cancellation must prevent its publication. */
  onRemember?: (rules: readonly PermissionRule[], signal: AbortSignal) => void | Promise<void>;
};

export type ApprovalChoice = "allow_once" | "allow_session" | "allow_always" | "deny";

export type PendingApproval = {
  id: string;
  createdAt: number;
  request: PermissionRequest;
  /** Risk ids that asked; `allow_always` remembers a rule for each of them. */
  askedRisks?: string[];
  /** False when only risks asked and the action itself was already allowed. */
  askedAction?: boolean;
  reason?: string;
  humanOnly?: boolean;
};

/** How an approval ended for the waiting tool call. */
export type ApprovalOutcome =
  | { choice: ApprovalChoice; by: "user"; feedback?: string }
  | { choice: "deny"; by: "timeout" | "aborted" | "policy" | "persistence" };

export type ApprovalPrompt = {
  id: string;
  request: PermissionRequest;
  reason: string;
  callId?: string;
  humanOnly?: boolean;
};

/** Lets a tool call wait for the user's answer instead of failing with "approval required". */
export interface ApprovalGate {
  wait(
    prompt: ApprovalPrompt,
    signal: AbortSignal,
    authority?: PermissionEngine,
  ): Promise<ApprovalOutcome>;
}

export type ApprovalDecision = {
  id: string;
  request: PermissionRequest;
  choice: ApprovalChoice;
  createdAt: number;
  resolvedAt: number;
  stale: boolean;
  persistence?: Promise<void>;
  feedback?: string;
};

export type SandboxDecision = {
  allowed: boolean;
  reason: string;
};

export type SandboxOptions = {
  workspaceRoot: string;
  allowNetwork?: boolean;
  readDenyPrefixes?: string[];
  writeDenyPrefixes?: string[];
  envAllowlist?: string[];
};
