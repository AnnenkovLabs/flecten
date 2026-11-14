import type { HookConfiguration, HookName } from "../../../shared/hooks";
import type { AgentInfo, AgentPendingApproval } from "./agent-types";
import type { IconName } from "./icons";
import type { ErrorItem } from "./run-errors";

export type { IconName };

export type TaskStatus = "working" | "review" | "done";
export type TaskStatusKind = TaskStatus | "stopped" | "error" | "waiting" | "interrupted";

export interface Task {
  id: string;
  title: string;
  status: TaskStatusKind;
  age: string;
  updatedAt?: string;
  lastPrompt?: string;
  messageCount?: number;
}

export interface Project {
  id: string;
  name: string;
  age: string;
  current?: boolean;
  tasks?: Task[];
}

export type FileKind = "ts" | "test" | "js" | "css" | "json" | "md" | "py" | "rs" | "other";

export interface FileChange {
  path: string;
  kind: FileKind;
  add: number;
  del?: number;
}

export interface RunActionDetail {
  input?: unknown;
  resultData?: unknown;
  output?: string;
  error?: string;
  fullOutputPath?: string;
  file?: string;
  line?: number;
  exitCode?: number;
  hunks?: DiffHunk[];
  durationMs?: number;
}

export interface RunAction {
  subagent?: import("../../../shared/subagents").SubagentInfo;
  id: string;
  tool?: string;
  icon: IconName;
  label: string;
  subject?: string;
  state?: "queued" | "succeeded" | "failed" | "interrupted" | "cancelled";
  meta?: string;
  add?: number;
  del?: number;
  duration: string;
  failed?: boolean;
  running?: boolean;
  detail?: RunActionDetail;
}

export interface RunTurn {
  index: number;
  reasoning: string;
  reasoningStreaming?: boolean;
  reasoningMs?: number;
  actions: RunAction[];
}

export interface RunSummary {
  duration: string;
  startedAt?: number;
  actions: number;
  criteria: number;
  list: RunAction[];
  turns: RunTurn[];
  text: string;
  files: FileChange[];
  prompt?: string;
  live?: boolean;
  failed?: boolean;
  stopped?: boolean;
}

export interface PendingToolCall {
  index: number;
  name: string;
  args: string;
}

export type DiffLineKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  kind: FileKind;
  state: "M" | "A";
  add: number;
  del?: number;
  hunks: DiffHunk[];
}

export interface TerminalLine {
  prompt?: boolean;
  text: string;
  tone?: "pass" | "muted";
  cursor?: boolean;
}

export interface WorkerItem {
  kind: "worker";
  id: string;
  sessionId: string;
  status: "running" | "done" | "stopped" | "error" | "interrupted";
  actions: RunAction[];
}

export type ThreadItem =
  | WorkerItem
  | { kind: "worker-tool"; id: string; reference: string }
  | { kind: "message"; id: string; text: string; at?: string }
  | ApprovalItem
  | NoticeItem
  | { kind: "run"; id: string; summary: RunSummary }
  | {
      kind: "answer";
      id: string;
      text: string;
      at?: string;
      streaming?: boolean;
      summaryHtml?: string;
      complete?: boolean;
    }
  | ErrorItem;

/** A tool call waiting for the user's permission, inline in the thread. */
export interface ApprovalItem {
  kind: "approval";
  id: string;
  sessionId: string;
  approval: AgentPendingApproval;
  owner?: "worker";
  state: "pending" | "allow_once" | "allow_session" | "allow_always" | "deny";
  resolving?: boolean;
  error?: string;
  by?: "user" | "timeout" | "aborted" | "policy" | "persistence";
}

/** A line in the thread about the run itself: interrupted, resumed, a job finished, a budget. */
export interface NoticeItem {
  kind: "notice";
  id: string;
  icon: IconName;
  text: string;
  meta?: string;
  tone?: "info" | "warn";
  /** `continue`: the card offers to resume the task. */
  action?: "continue";
  at?: string;
}

export type TabId = "changes" | "history" | "terminal" | "worker";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ReasoningChoice = ReasoningEffort | "auto";

export type ProviderProtocol = "openai-chat" | "openai-responses" | "anthropic-messages" | "gemini";

export type ReasoningMode = "effort" | "budget" | "toggle" | "none";

export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelVariant {
  name?: string;
  reasoning?: ReasoningEffort;
  temperature?: number;
  maxOutputTokens?: number;
  cost?: ModelCost;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface ModelCompat {
  reasoningReplay?: "auto" | "always" | "never" | "alias";
  reasoningDetails?: "auto" | "always" | "never";
  thinking?: "auto" | "enabled" | "disabled";
  thinkingParam?: "auto" | "thinking" | "enable_thinking" | "none";
  thinkingKeep?: "auto" | "all" | "none";
  clearThinking?: "auto" | "keep" | "clear";
  preserveThinking?: "auto" | "on" | "off";
  promptCaching?: boolean;
  streamUsage?: boolean;
  strictTools?: boolean;
}

export interface ModelVerification {
  text?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  at?: string;
}

export interface ModelInfo {
  name?: string;
  apiId?: string;
  protocol?: ProviderProtocol;
  context?: number;
  input?: number;
  output?: number;
  tools?: boolean;
  reasoning?: boolean;
  reasoningMode?: ReasoningMode;
  reasoningLevels?: ReasoningEffort[];
  reasoningBudget?: number;
  reasoningToggle?: boolean;
  vision?: boolean;
  temperature?: boolean;
  structuredOutput?: boolean;
  audio?: boolean;
  pdf?: boolean;
  computerUse?: boolean;
  promptCache?: boolean;
  parallelToolCalls?: boolean;
  interleavedReasoning?: boolean;
  maxTokensParameter?: "auto" | "max_tokens" | "max_completion_tokens";
  disabled?: boolean;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  cost?: ModelCost;
  knowledge?: string;
  releaseDate?: string;
  openWeights?: boolean;
  attachment?: boolean;
  canonicalId?: string;
  modalities?: { input?: string[]; output?: string[] };
  variants?: Record<string, ModelVariant>;
  compat?: ModelCompat;
  verified?: ModelVerification;
  source?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKeySet: boolean;
  keySource?: "command" | "stored" | "env" | "none";
  models: Record<string, ModelInfo>;
  active: boolean;
}

export interface ProviderSettings {
  protocol: ProviderProtocol;
  baseUrl: string;
  proxy?: string;
  transportTimeoutMs?: number;
  apiKeyEnv?: string;
  apiKey?: string;
  name?: string;
  headers: Record<string, string>;
  models: Record<string, ModelInfo>;
  reasoningReplay: "auto" | "always" | "never" | "alias";
  reasoningDetails: "auto" | "always" | "never";
  thinking: "auto" | "enabled" | "disabled";
  thinkingParam: "auto" | "thinking" | "enable_thinking" | "none";
  thinkingKeep: "auto" | "all" | "none";
  clearThinking: "auto" | "keep" | "clear";
  preserveThinking: "auto" | "on" | "off";
  promptCaching: boolean;
  streamUsage: boolean;
  strictTools: boolean;
  parallelToolCalls?: boolean;
  promptCacheKey?: string;
  maxOutputTokens?: number;
  extraBody?: Record<string, unknown>;
  auth?: {
    command: string;
    args: string[];
    timeoutMs: number;
    refreshIntervalMs: number;
  };
}

export interface McpStdioSettings {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  enabled: boolean;
  protocol: "auto" | "legacy" | "2026-07-28";
  timeoutMs: number;
  maxTools: number;
  allowTools?: string[];
  readOnly?: boolean;
  contextTokens?: number;
}
export interface McpHttpSettings {
  url: string;
  headers: Record<string, string>;
  oauth?: { clientId?: string; scopes: string[] };
  enabled: boolean;
  timeoutMs: number;
  maxTools: number;
  protocolVersion?: string;
  allowTools?: string[];
  readOnly?: boolean;
  contextTokens?: number;
}
export type McpServerSettings = McpStdioSettings | McpHttpSettings;

export type HookCommandSettings = Omit<HookConfiguration, "type" | "async" | "failClosed"> &
  Partial<Pick<HookConfiguration, "type" | "async" | "failClosed">>;

export type HooksSettings = Record<HookName, HookCommandSettings[]>;

export interface HarnessSettings {
  permissions?: {
    read: import("./permissions").Policy;
    write: import("./permissions").Policy;
    shell: import("./permissions").Policy;
    network: import("./permissions").Policy;
    mcp: import("./permissions").Policy;
    skill: import("./permissions").Policy;
    externalPath: import("./permissions").Policy;
    destructive: import("./permissions").Policy;
    approvalTimeoutMs: number;
    rules: import("./permissions").SavedPermissionRule[];
  };
  vision?: { provider: string; model: string };
  conversation?: { enabled: boolean };
  translation?: {
    enabled: boolean;
    provider: string;
    model: string;
    language: string;
    timeoutMs: number;
  };
  telemetry?: { enabled: boolean; endpoint?: string };
  update?: {
    channel: "stable" | "beta";
    feedUrl?: string;
    github?: { owner: string; repo: string };
    autoCheck: boolean;
    autoDownload: boolean;
    installOnQuit: boolean;
  };
  skills?: {
    sources: import("./settings/skill-sources").SkillSourceId[];
    trust?: Record<string, "trusted" | "untrusted">;
  };
  voice?: import("./voice-settings").VoiceSettingsConfig;
  ui?: import("./preferences.svelte").AppPreferences;
  sessions?: {
    retentionDays: number;
    maxSessions: number;
    trashDays: number;
    maxConcurrent: number;
    autoResume: boolean;
  };
  terminal?: {
    shell?: string | undefined;
    scrollback: number;
    commandTimeoutMs: number;
    jobWaitMs: number;
    jobTimeoutMs?: number | undefined;
    ansi: boolean;
    notifyOnExit: boolean;
    envAllowlist?: string[];
    maxProcesses: number;
    maxMemoryMb: number;
  };
  checkpoints?: {
    shell: boolean;
    maxFiles: number;
    maxMegabytes: number;
    keep: number;
    maxAgeDays: number;
  };
  useDefaults?: boolean;
  provider: string;
  model: string;
  reasoning?: ReasoningEffort;
  variant?: string;
  providers: Record<string, ProviderSettings>;
  mcp?: { servers: Record<string, McpServerSettings> };
  hooks?: HooksSettings;
  maxOutputTokens: number;
  catalog?: { autoRefresh: boolean; ttlMs: number };
  context: { window: number; reserve: number };
  sandbox?: {
    enabled: boolean;
    allowNetwork: boolean;
    readDenyPrefixes: string[];
    writeDenyPrefixes: string[];
    envAllowlist: string[];
  };
  loop: { maxTurns: number; continuations: number; parallelTools: boolean };
  tools: {
    maxOutputBytes: number;
    maxOutputLines: number;
    bashTimeoutMs: number;
    readLimitLines: number;
  };
}

export interface CatalogSummary {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  apiKeyEnv?: string;
  modelCount: number;
}

export interface CatalogProviderInfo {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKeyEnv?: string;
  models: Record<string, ModelInfo>;
  source: string;
}

export interface DiscoverResult {
  providerId: string;
  providerName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  models: Record<string, ModelInfo>;
  warnings: string[];
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

export interface CatalogStatus {
  updatedAt?: string;
  stale: boolean;
  providers: number;
  models: number;
  fallbackModels: number;
}

export interface ProbeResult {
  text: boolean;
  tools: boolean;
  reasoning?: boolean;
  latencyMs: number;
  error?: string;
}

export interface ProviderActualizeResult {
  providerId: string;
  info: AgentInfo;
  models: number;
  added: string[];
  updated: string[];
  removed: string[];
  warnings: string[];
  probedModel: string;
  probe: ProbeResult;
}

export type { AgentCommand, AgentEvent } from "./agent-protocol";
export type * from "./agent-types";
