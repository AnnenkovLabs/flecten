import type { SessionPhase } from "../../../shared/session-state";
import type { PromptTextPart } from "../../context/prompt-budget";
import type { ModelProvider } from "../../providers/types";
import type { PermissionEngine } from "../../security/permissions";
import type { SandboxPolicy } from "../../security/sandbox";
import type { TerminalSettingsInput } from "../../terminal/settings";
import type { ToolRegistry } from "../../tools/registry";
import type { SubagentRunnerFactory } from "../../tools/task/run";
import type { OsSandboxContext, ToolContext, ToolLimits } from "../../tools/types";
import type { LanguageOptions } from "../../translation/run";
import type { AttachmentReference } from "../attachment-reference";
import type { DictionaryPort } from "../dictionary/runtime";
import type { GoalBudget } from "../goal/types";
import type { HooksConfig } from "../hooks/types";
import type { PageSink } from "../pages/writer";
import type { PromptStamp } from "../prompt";
import type { SerializedQueue } from "../queue/types";
import type { Event, ImagePart, Message, ReasoningEffort, SessionId } from "../types";
import type { BudgetLimits, UsagePrice } from "./budget";
import type { SessionMemory } from "./run-input";

export interface SessionOptions {
  modules?: import("../modules/types").ModuleSessionPort;
  cwd: string;
  role?: "talker" | "worker";
  /** Bounded notices from an independent execution session, consumed at a safe boundary. */
  takeNotices?():
    | import("../loop/types").SteeringMessage[]
    | Promise<import("../loop/types").SteeringMessage[]>;
  provider: ModelProvider;
  providerId: string;
  model: string;
  tools: ToolRegistry;
  system: string;
  systemParts?: readonly PromptTextPart[];
  /** Conversation replies may end in Markdown; summaries and structured roles keep their contracts. */
  responseFormat?: "summary" | "structured" | "conversation";
  /** Version, hash and budget of `system`, stored with every run. */
  promptStamp?: PromptStamp;
  limits: ToolLimits;
  maxOutputTokens: number;
  reasoning?: ReasoningEffort | undefined;
  variant?: string | undefined;
  context: { window: number; reserve: number };
  loop: { maxTurns: number; continuations: number; parallelTools: boolean };
  goal?: GoalBudget;
  /** Token, cost and wall-clock limits of every run. */
  budgets?: BudgetLimits;
  /** An owning conversation may share a budget with independent background roles. */
  externalBudgetExhausted?(): string | undefined;
  /** Price of a usage for the cost limit; without it the cost limit cannot apply. */
  price?: UsagePrice;
  hooks?: HooksConfig;
  permissions?: PermissionEngine;
  /** Calls that need permission wait for the user's answer this long; 0 refuses at once. */
  approvalTimeoutMs?: number;
  inheritedApprovals?: import("../../security/types").ApprovalGate;
  approvalSessionId?: string;
  permissionActor?: string;
  permissionIntent?: ToolContext["permissionIntent"];
  sandbox?: SandboxPolicy | undefined;
  osSandbox?: OsSandboxContext | undefined;
  security?: ToolContext["security"];
  terminal?: TerminalSettingsInput;
  memory?: SessionMemory;
  dictionary?: DictionaryPort;
  language?: LanguageOptions | undefined;
  vision?: import("../vision").VisionOptions | undefined;
  /** Checkpoint store shared with the file tools; the core never imports the store layer. */
  checkpoints?: ToolContext["checkpoints"];
  /** Workspace snapshots around shell commands, so bash and terminal changes can be undone. */
  shellCheckpoints?: ToolContext["shellCheckpoints"] | undefined;
  /** Input modalities of the active model, used to decide how attachments reach it. */
  modalities?: readonly string[] | undefined;
  subagentRunnerFactory?: SubagentRunnerFactory;
  /** Saves compaction pages of a session as pages/N.md. */
  pages?(sessionId: SessionId): PageSink;
  /** Expands slash commands; the thread keeps what the user typed. */
  expandPrompt?(prompt: string): Promise<string>;
  logDir(sessionId: string): string;
  loadHistory?(sessionId: SessionId): Promise<Message[]>;
  saveMedia?(sessionId: SessionId, parts: readonly ImagePart[]): Promise<AttachmentReference[]>;
  loadMedia?(sessionId: SessionId, refs: readonly AttachmentReference[]): Promise<ImagePart[]>;
  /** Session this handle starts bound to, so its restored queue is saved before a run. */
  sessionId?: SessionId;
  initialPhase?: SessionPhase;
  interrupted?: boolean;
  /** Queue restored from disk for the session this handle starts with. */
  queue?: SerializedQueue;
  saveQueue?(sessionId: SessionId, queue: SerializedQueue): Promise<void>;
  onEvent?(event: Event): void | Promise<void>;
  /** Current credentials are used only by log redactors, never appended to model context. */
  secrets?(): readonly string[];
}
