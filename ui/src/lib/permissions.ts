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
] as const;

export type PolicyAction = (typeof POLICY_ACTIONS)[number];
export type Policy = "deny" | "auto" | "ask" | "allow";
export type PolicyMap = Record<PolicyAction, Policy>;
export type PresetId = "read_only" | "workspace" | "full" | "custom";
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
}

export interface ActionMeta {
  action: PolicyAction;
  label: string;
  description: string;
  icon: IconName;
  risk?: string;
}

export interface PolicyOption {
  value: Policy;
  label: string;
  description: string;
}

export interface PolicyPreset {
  id: Exclude<PresetId, "custom">;
  label: string;
  description: string;
  policies: PolicyMap;
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
    get risk() {
      return t("Commands can change files outside the project and send data out.");
    },
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
    get risk() {
      return t(
        "Requests go to an external server. The address and request body leave your machine.",
      );
    },
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
    get risk() {
      return t("Paths may lead outside the working folder, including to system files and secrets.");
    },
  },
};

export const PRESETS: readonly PolicyPreset[] = [
  {
    id: "read_only",
    get label() {
      return t("Read-only");
    },
    get description() {
      return t(
        "Reads the project and skills. Writing, shell commands, and external paths are blocked. Network and MCP access require approval.",
      );
    },
    policies: {
      read: "auto",
      write: "deny",
      shell: "deny",
      network: "ask",
      mcp: "ask",
      skill: "auto",
      external_path: "ask",
    },
  },
  {
    id: "workspace",
    get label() {
      return t("Working folder");
    },
    get description() {
      return t(
        "Writes within the project. Shell commands, network, MCP, and external paths require approval.",
      );
    },
    policies: {
      read: "auto",
      write: "auto",
      shell: "ask",
      network: "ask",
      mcp: "ask",
      skill: "auto",
      external_path: "ask",
    },
  },
  {
    id: "full",
    get label() {
      return t("Full access");
    },
    get description() {
      return t("Allows ordinary actions. Destructive rules and sandbox limits still apply.");
    },
    policies: {
      read: "allow",
      write: "allow",
      shell: "allow",
      network: "allow",
      mcp: "allow",
      skill: "allow",
      external_path: "allow",
    },
  },
];

const CUSTOM_DESCRIPTION = "These settings don't match any preset. Check each row before saving.";

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

export function applyPreset(preset: PresetId, current: PolicyMap = buildPolicy()): PolicyMap {
  if (preset === "custom") return { ...current };
  const match = PRESETS.find((entry) => entry.id === preset);
  return match ? { ...match.policies } : { ...current };
}

export function isCustom(policy: PolicyMap): boolean {
  return !PRESETS.some((preset) =>
    POLICY_ACTIONS.every((action) => preset.policies[action] === policy[action]),
  );
}

export function presetDescription(preset: PresetId): string {
  if (preset === "custom") return t(CUSTOM_DESCRIPTION);
  return PRESETS.find((entry) => entry.id === preset)?.description ?? t(CUSTOM_DESCRIPTION);
}

export function approvalAgeLabel(requestedAt: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - requestedAt);
  if (elapsed < 5_000) return t("just now");
  if (elapsed < 60_000) return t("{0} sec", [Math.floor(elapsed / 1_000)]);
  if (elapsed < 3_600_000) return t("{0} min", [Math.floor(elapsed / 60_000)]);
  if (elapsed < 86_400_000) return t("{0} hr", [Math.floor(elapsed / 3_600_000)]);
  return t("{0} d", [Math.floor(elapsed / 86_400_000)]);
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

export function validatePolicy(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [t("Policies must be an object.")];
  }
  const errors: string[] = [];
  for (const [action, policy] of Object.entries(value)) {
    if (!isPolicyAction(action)) {
      errors.push(t("Unknown action: {0}.", [action]));
      continue;
    }
    if (!isPolicy(policy)) {
      errors.push(t("Unknown policy for action {0}: {1}.", [action, String(policy)]));
    }
  }
  return errors;
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
    default:
      return t("Allow this action?");
  }
}

function isPolicyAction(value: string): value is PolicyAction {
  return (POLICY_ACTIONS as readonly string[]).includes(value);
}

function isPolicy(value: unknown): value is Policy {
  return typeof value === "string" && POLICY_OPTIONS.some((option) => option.value === value);
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
