import { z } from "zod";
import type { MemoryRuntime } from "../core/memory/runtime";
import type { PageRuntime } from "../core/pages/runtime";
import type { SubagentTasks } from "../core/subagents/tasks";
import type { Provenance, ToolResult } from "../core/types";
import type { PermissionEngine } from "../security/permissions";
import type { SandboxPolicy } from "../security/sandbox";
import type { ApprovalGate } from "../security/types";
import type { CheckpointStore, ShellCheckpoints } from "../store/checkpoints";
import type { TerminalManager } from "../terminal/manager";
import type { ReadTracker } from "./util/read-tracker";

export type ToolSource = "builtin" | "mcp" | "skill" | "module";

export type ToolFailureKind =
  | "transient"
  | "validation"
  | "permission"
  | "timeout"
  | "aborted"
  | "client";

export class ToolFailure extends Error {
  readonly kind: ToolFailureKind;

  constructor(kind: ToolFailureKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ToolFailure";
    this.kind = kind;
  }
}

export function isToolFailureKind(value: unknown): value is ToolFailureKind {
  return (
    value === "transient" ||
    value === "validation" ||
    value === "permission" ||
    value === "timeout" ||
    value === "aborted" ||
    value === "client"
  );
}

export interface ToolLimits {
  maxOutputBytes: number;
  maxOutputLines: number;
  bashTimeoutMs: number;
  readLimitLines: number;
}

export interface OsSandboxContext {
  enabled: boolean;
  allowNetwork: boolean;
  workspaceRoot: string;
  envAllowlist: string[];
  writablePaths?: string[];
  readOnlyPaths?: string[];
  readDeniedPaths?: string[];
}

export interface ToolContext {
  inspectImage?: import("../core/vision").InspectImage | undefined;
  /** Set by the guarded surface executor, never read from model tool arguments. */
  invocationOrigin?: "module-surface";
  services?: import("../core/services/registry").Services | undefined;
  saveMedia?(
    parts: readonly import("../core/types").ImagePart[],
  ): Promise<import("../core/attachment-reference").AttachmentReference[]>;
  /** Nested capabilities use the same validation, permissions, hooks, cancellation and logs. */
  invokeTool?(tool: Tool, args: unknown, context?: ToolContext): Promise<ToolResult>;
  callId?: string;
  subagents?: SubagentTasks;
  waitSignal?: AbortSignal;
  memory?: MemoryRuntime;
  contextPages?: Pick<PageRuntime, "execute" | "guard">;
  sessionId: string;
  cwd: string;
  signal: AbortSignal;
  logDir: string;
  reportOutput?(text: string): void;
  limits: ToolLimits;
  reads: ReadTracker;
  permissions?: PermissionEngine;
  sandbox?: SandboxPolicy | undefined;
  osSandbox?: OsSandboxContext | undefined;
  /** Current execution boundary, refreshed for each call and again after approval. */
  security?(): { sandbox: SandboxPolicy | undefined; osSandbox: OsSandboxContext | undefined };
  checkpoints?: CheckpointStore;
  /** Snapshots around bash, terminal and background jobs, so shell changes can be undone too. */
  shellCheckpoints?: ShellCheckpoints;
  /** Waits for the user's answer when a permission asks. */
  approvals?: ApprovalGate;
  approvalSessionId?: string;
  permissionActor?: string;
  /** Host-only original human intent. Delegated task text never supplies authority. */
  permissionIntent?: () => string | undefined;
  terminals?: TerminalManager;
  env?: Record<string, string>;
  secrets?: readonly string[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodType<unknown>;
  source?: ToolSource;
  mutating: boolean;
  /** Host descriptor from a revision-trusted module manifest, never an MCP annotation. */
  permissionSafety?: "read-only";
  timeoutMs?(args: unknown): number;
  /** Set for tools whose output the outside world wrote; the model sees it as untrusted data. */
  provenance?(args: unknown): Provenance;
  execute(args: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface ToolDefinition<T> {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  source?: ToolSource;
  mutating?: boolean;
  timeoutMs?: (args: T) => number;
  provenance?: (args: T) => Provenance;
  execute(args: T, context: ToolContext): Promise<ToolResult>;
}

export function defineTool<T>(definition: ToolDefinition<T>): Tool {
  const generated = z.toJSONSchema(definition.schema) as Record<string, unknown>;
  const { $schema: _schema, ...parameters } = generated;
  const provenance = definition.provenance;
  return {
    name: definition.name,
    description: definition.description,
    parameters: { ...parameters, required: parameters.required ?? [] },
    schema: definition.schema as z.ZodType<unknown>,
    source: definition.source ?? "builtin",
    mutating: definition.mutating ?? false,
    ...(definition.timeoutMs
      ? { timeoutMs: (args: unknown) => definition.timeoutMs?.(args as T) ?? 0 }
      : {}),
    ...(provenance ? { provenance: (args: unknown) => provenance(args as T) } : {}),
    execute: (args, context) => definition.execute(args as T, context),
  };
}
