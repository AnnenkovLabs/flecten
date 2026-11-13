import type { ZodType } from "zod";
import type { PermissionEngine } from "../../security/permissions";
import type { PermissionRule } from "../../security/types";
import type { Message, ToolCall, Usage } from "../types";
import type { LeafSessionEvent } from "../types/event";

export type SubagentPermissions = readonly PermissionRule[];

export interface SubagentBudget {
  maxTurns: number;
  maxTokens: number;
  maxCost?: number;
}

export type SubagentUsage = Usage & { cost?: number };

export interface SubagentSpec {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: readonly string[];
  provider?: string;
  model?: string;
  permissions: SubagentPermissions;
  budget: SubagentBudget;
  resultSchema: ZodType;
  source?: "builtin" | "definition";
  sourcePath?: string;
}

export interface SubagentChildRequest {
  onEvent?: (event: LeafSessionEvent) => void;
  parentPermissions?: PermissionEngine;
  parentApprovals?: import("../../security/types").ApprovalGate;
  approvalSessionId?: string;
  permissionIntent?: import("../../tools/types").ToolContext["permissionIntent"];
  parentAuthorize?: (toolName: string) => string | undefined;
  spec: SubagentSpec;
  systemPrompt: string;
  messages: Message[];
  allowedTools: readonly string[];
  permissions: SubagentPermissions;
  budget: SubagentBudget;
  parentContext?: string;
  signal: AbortSignal;
}

export interface SubagentChildResult {
  text: string;
  usage: SubagentUsage;
  toolCalls?: readonly ToolCall[];
  /** Actual model turns, independent of the number of parallel tool calls. */
  turns?: number;
  error?: string;
}

export type SubagentChildRunner = (request: SubagentChildRequest) => Promise<SubagentChildResult>;

export interface SubagentRunOptions {
  onEvent?: (event: LeafSessionEvent) => void;
  runChild: SubagentChildRunner;
  signal?: AbortSignal;
  parentContext?: string;
}

export interface SubagentRunResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  usage: SubagentUsage;
  error?: string;
}
