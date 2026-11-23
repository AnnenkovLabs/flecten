import type { ActiveAccessMode } from "../../../shared/access-mode";
import { t } from "./i18n.svelte";
import type { IconName } from "./types";

export const POLICY_ACTIONS = [
  "read",
  "write",
  "shell",
  "network",
  "mcp",
  "skill",
  "external_path",
  "destructive",
] as const;

export type PolicyAction = (typeof POLICY_ACTIONS)[number];
export type Policy = "deny" | "auto" | "ask" | "allow";
export type PolicyMap = Record<PolicyAction, Policy>;
export type ApprovalDecision = "allow_once" | "allow_session" | "allow_always" | "deny";

export interface ApprovalView {
  id: string;
  tool: string;
  action: string;
  target: string;
  reason: string;
  requestedAt: number;
  sessionId?: string;
  humanOnly?: boolean;
  expiresAt?: number;
  cwd?: string;
  risks?: Array<{ id: string; label: string; detail: string }>;
  grantLabel?: string;
  arguments?: Array<{ name: string; value: string }>;
  paths?: string[] | undefined;
}

export interface ActionMeta {
  action: PolicyAction;
  label: string;
  description: string;
  icon: IconName;
}

export interface PolicyOption {
  value: Policy;
  label: string;
  description: string;
}

export const POLICY_OPTIONS: readonly PolicyOption[] = [
  {
    value: "deny",
    get label() {
      return t("Deny");
    },
    get description() {
      return t("Always block.");
    },
  },
  {
    value: "auto",
    get label() {
      return t("Auto");
    },
    get description() {
      return t(
        "Allow bounded built-in actions. Review eligible calls separately; ask when uncertain.",
      );
    },
  },
  {
    value: "ask",
    get label() {
      return t("Ask");
    },
    get description() {
      return t("Ask unless this exact action was already approved.");
    },
  },
  {
    value: "allow",
    get label() {
      return t("Allow");
    },
    get description() {
      return t("Allow without asking.");
    },
  },
];

export const STANDARD_POLICY_OPTIONS: readonly PolicyOption[] = POLICY_OPTIONS.filter(
  (option) => option.value !== "auto",
);

/** Show legacy Auto only when already configured, keeping normal rows to Deny / Ask / Allow. */
export function policyOptionsFor(value: Policy): readonly PolicyOption[] {
  return value === "auto" ? POLICY_OPTIONS : STANDARD_POLICY_OPTIONS;
}

export const ACTION_META: Record<PolicyAction, ActionMeta> = {
  read: {
    action: "read",
    get label() {
      return t("Read");
    },
    get description() {
      return t("Project files, documentation, and search results.");
    },
    icon: "file",
  },
  write: {
    action: "write",
    get label() {
      return t("Write");
    },
    get description() {
      return t("Create, edit, and delete files.");
    },
    icon: "edit",
  },
  shell: {
    action: "shell",
    get label() {
      return t("Terminal");
    },
    get description() {
      return t("Shell commands and child processes.");
    },
    icon: "terminal",
  },
  network: {
    action: "network",
    get label() {
      return t("Network");
    },
    get description() {
      return t("External addresses, downloads, and web requests.");
    },
    icon: "refresh",
  },
  mcp: {
    action: "mcp",
    label: "MCP",
    get description() {
      return t("Tools from connected MCP servers.");
    },
    icon: "server",
  },
  skill: {
    action: "skill",
    get label() {
      return t("Skills");
    },
    get description() {
      return t("Activate skills and read their resources.");
    },
    icon: "spark",
  },
  external_path: {
    action: "external_path",
    get label() {
      return t("External paths");
    },
    get description() {
      return t("Files outside the working folder.");
    },
    icon: "folder",
  },
  destructive: {
    action: "destructive",
    get label() {
      return t("Destructive actions");
    },
    get description() {
      return t("Irreversible operations like force push or deleting outside the project.");
    },
    icon: "trash",
  },
};

export function accessModeLabel(mode: ActiveAccessMode): string {
  switch (mode) {
    case "agent":
      return t("Agent");
    case "confirm":
      return t("Confirm changes");
    case "full":
      return t("Full access");
    case "custom":
      return t("Custom access");
  }
}

export function accessModeDescription(mode: ActiveAccessMode): string {
  switch (mode) {
    case "agent":
      return t(
        "Reads, edits and runs commands in the project. Asks before accessing another folder or destructive actions.",
      );
    case "confirm":
      return t("Reads freely. Asks before changes, commands and connected tools.");
    case "full":
      return t("Works across your computer without routine approvals. Process isolation is off.");
    case "custom":
      return t("Advanced settings differ from these modes.");
  }
}

export function approvalSessionLabel(action: string): string {
  return action === "external_path" ? t("For this chat") : t("Repeat this action in this chat");
}

export function approvalScopePaths(approval: Pick<ApprovalView, "target" | "paths">): string[] {
  return [approval.target || approval.paths?.[0] || ""].filter(Boolean);
}

export function buildPolicy(
  source: Readonly<Partial<Record<PolicyAction, Policy>>> = {},
  fallback: Policy = "ask",
): PolicyMap {
  const policy = {} as PolicyMap;
  for (const action of POLICY_ACTIONS) {
    policy[action] = source[action] ?? fallback;
  }
  return policy;
}

export function isApprovalExpired(
  expiresAt: number | undefined,
  now: number = Date.now(),
): boolean {
  return expiresAt !== undefined && now >= expiresAt;
}

export function reviewedApprovalIds(
  reviewed: readonly Pick<ApprovalView, "id">[],
  pending: readonly ApprovalView[],
  now: number = Date.now(),
): string[] {
  const live = new Set(
    pending.filter((item) => !isApprovalExpired(item.expiresAt, now)).map((item) => item.id),
  );
  return reviewed.map((item) => item.id).filter((id) => live.has(id));
}

export function sortApprovals(approvals: readonly ApprovalView[]): ApprovalView[] {
  return [...approvals].sort((left, right) => {
    if (left.requestedAt !== right.requestedAt) return left.requestedAt - right.requestedAt;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });
}

export function actionLabel(action: string): string {
  return isPolicyAction(action) ? ACTION_META[action].label : action;
}

export function approvalActionTitle(action: string): string {
  switch (action) {
    case "read":
      return t("Read files?");
    case "write":
      return t("Change files?");
    case "shell":
      return t("Run command?");
    case "network":
      return t("Access the network?");
    case "mcp":
      return t("Use connected tool?");
    case "skill":
      return t("Activate skill?");
    case "external_path":
      return t("Allow folder access?");
    default:
      return t("Allow this action?");
  }
}

export interface SavedPermissionRule {
  checkpoint?: boolean;
  action: string;
  policy: Policy;
  tool?: string;
  pathPrefix?: string;
  risk?: string;
  requestKey?: string;
  target?: string;
  cwd?: string;
  note?: string;
}

function isPolicyAction(value: string): value is PolicyAction {
  return (POLICY_ACTIONS as readonly string[]).includes(value);
}
