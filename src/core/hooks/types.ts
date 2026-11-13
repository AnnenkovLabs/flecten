import type { HookName, HookRun, HookSource } from "../../../shared/hooks";

export type { HookName, HookRun } from "../../../shared/hooks";

export interface CanonicalHookMatcher {
  tool?: string | undefined;
  path?: string | undefined;
  pathPrefix?: string | undefined;
  command?: string | undefined;
  commandPrefix?: string | undefined;
}

export interface HookDefinition {
  id?: string | undefined;
  name?: string | undefined;
  responseFormat?: "json" | "text" | undefined;
  source?: HookSource | undefined;
  type?: "command" | "http" | undefined;
  command?: string | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
  env?: Record<string, string> | undefined;
  envAllowlist?: string[] | undefined;
  matcher?: string | CanonicalHookMatcher | undefined;
  timeoutMs: number;
  enabled: boolean;
  async?: boolean | undefined;
  /** A failed, timed-out or unreadable run blocks the action instead of letting it through. */
  failClosed?: boolean | undefined;
}

export type HooksConfig = {
  [K in HookName]?: HookDefinition[];
};

export type PermissionAction =
  | "read"
  | "write"
  | "shell"
  | "network"
  | "mcp"
  | "skill"
  | "external_path";

export interface PermissionHookPayload {
  action: PermissionAction;
  policy: "ask" | "auto" | "allow" | "deny";
  tool?: string;
  target?: string;
  reason?: string;
}

export interface CompactHookPayload {
  summary: string;
  reason: "auto" | "manual" | "overflow";
  tokensBefore?: number;
  tokensAfter?: number;
}

export interface NotificationHookPayload {
  level: "info" | "warning" | "error";
  message: string;
  code?: string;
}

export interface SubagentHookPayload {
  agent: string;
  phase: "start" | "stop";
  task?: string;
  output?: string;
  ok?: boolean;
}

export interface ToolBatchHookPayload {
  tools: Array<{ name: string; args?: unknown }>;
  parallel: boolean;
}

export interface HookInput {
  sessionId: string;
  cwd: string;
  prompt?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolOk?: boolean;
  toolOutput?: string;
  toolError?: string;
  stopReason?: string;
  target?: string;
  permission?: PermissionHookPayload;
  compact?: CompactHookPayload;
  notification?: NotificationHookPayload;
  subagent?: SubagentHookPayload;
  toolBatch?: ToolBatchHookPayload;
}

export interface SessionStartHookInput {
  sessionId: string;
  cwd: string;
  prompt?: string;
}

export interface UserPromptSubmitHookInput {
  sessionId: string;
  cwd: string;
  prompt: string;
}

export interface PreToolUseHookInput {
  sessionId: string;
  cwd: string;
  toolName: string;
  toolArgs?: unknown;
}

export interface PostToolUseHookInput extends PreToolUseHookInput {
  toolOk: boolean;
  toolOutput?: string;
  toolError?: string;
}

export interface StopHookInput {
  sessionId: string;
  cwd: string;
  stopReason: string;
}

export interface SessionEndHookInput extends StopHookInput {}

export interface PermissionHookInput extends HookInput {
  permission: PermissionHookPayload;
}

export interface CompactHookInput extends HookInput {
  compact: CompactHookPayload;
}

export interface NotificationHookInput extends HookInput {
  notification: NotificationHookPayload;
}

export interface SubagentHookInput extends HookInput {
  subagent: SubagentHookPayload;
}

export interface ToolBatchHookInput extends HookInput {
  toolBatch: ToolBatchHookPayload;
}

export interface HookResponse {
  decision?: "allow" | "deny";
  reason?: string;
  additionalContext?: string;
}

export interface HookOutcome {
  blocked: boolean;
  reason?: string;
  context: string[];
  runs: HookRun[];
}

export interface HookRunnerOptions {
  onRun?: (run: HookRun) => void;
}

export function emptyHookOutcome(): HookOutcome {
  return { blocked: false, context: [], runs: [] };
}
