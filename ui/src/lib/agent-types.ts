import type { SessionState } from "../../../shared/session-state";
// Shapes the agent core sends over the wire: info, sessions, runs, jobs, approvals and checkpoints.
import type { ContextUsage } from "./agent-protocol";
import type { CatalogStatus, ProviderInfo, ReasoningEffort } from "./types";

export interface AgentNotice {
  type: "notice.applied";
  sessionId: string;
  text: string;
  moduleReferences?: import("../../../shared/modules").ModuleReference[];
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  stopReason?: AgentRunResult["stopReason"];
  /** A run was active when the core stopped; it can be resumed. */
  interrupted?: boolean;
  running?: boolean;
  project?: string;
  createdAt?: string;
  messageCount?: number;
  tokens?: number;
  lastPrompt?: string;
}

export interface AgentUsage {
  input: number;
  output: number;
  cached: number;
  reasoning?: number;
  cacheWrite?: number;
}

export interface AgentMcpServer {
  id: string;
  state: "connecting" | "ready" | "degraded" | "closed" | "failed";
  tools: number;
  available?: number;
  protocol?: string;
  error?: string;
  diagnostics?: string[];
  lastError?: string;
  readOnly?: boolean;
  resources?: number;
  prompts?: number;
  oauth?: {
    server: string;
    url: string;
    scopes: string[];
    clientId?: string;
    tokenStorage: string;
  };
}

export interface AgentSkillDiagnostic {
  level: "warning" | "error";
  source: string;
  message: string;
}

export interface AgentInfo {
  configPath?: string;
  cwd: string;
  project: string;
  branch: string;
  user: string;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  ui?: { sendShortcut: "enter" | "modifier-enter"; followUpBehavior: "queue" | "steer" };
  update?: {
    channel: "stable" | "beta";
    feedUrl?: string;
    github?: { owner: string; repo: string };
    autoCheck: boolean;
    autoDownload: boolean;
    installOnQuit: boolean;
  };
  providers: ProviderInfo[];
  reasoning?: ReasoningEffort;
  variant?: string;
  cost?: number;
  secretBackend?: "keychain" | "file";
  catalog?: CatalogStatus;
  configError?: string;
  sandbox?: {
    enabled: boolean;
    kind: "bubblewrap" | "seatbelt" | "none";
    available: boolean;
    reason: string;
    warning?: string;
  };
  skills?: {
    count: number;
    names: string[];
    diagnostics: AgentSkillDiagnostic[];
  };
  mcp?: {
    tools: number;
    servers: AgentMcpServer[];
  };
  running?: boolean;
  sessionState?: SessionState;
  sessionId?: string;
  turns?: number;
  usage?: AgentUsage;
  context?: ContextUsage;
  approvals?: AgentApproval[];
  /** Version, hash and budget of the system prompt the next run uses. */
  system?: AgentPromptStamp;
  shellCheckpoints?: { state: "ready" | "indexing" | "off" | "unavailable"; reason?: string };
  budget?: AgentBudget;
  jobs?: AgentJob[];
  queue?: AgentQueueItem[];
  /** Every task the core holds: running, waiting in queue, approvals and jobs. */
  sessions?: AgentSessionActivity[];
}

export interface AgentPromptStamp {
  version: string;
  base: string;
  hash: string;
  tokens: number;
  maxTokens: number;
  overBudget: boolean;
  parts: Array<{ id: string; tokens: number; trimmed: boolean; omitted: boolean }>;
}

export interface AgentBudgetAmounts {
  tokens?: number;
  costUsd?: number;
  wallClockMs?: number;
}

export interface AgentBudget {
  limits: AgentBudgetAmounts;
  spent: { tokens: number; costUsd?: number; wallClockMs: number };
  remaining: AgentBudgetAmounts;
  exceeded?: "tokens" | "cost" | "wall_clock";
}

export interface AgentJob {
  id: string;
  command: string;
  cwd: string;
  status: "running" | "exited" | "failed" | "stopped";
  pid: number | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  logBytes: number;
  error: string | null;
}

export interface AgentQueueItem {
  id: string;
  text: string;
  mode: "queue" | "steer";
  state: "pending" | "sending" | "sent" | "cancelled";
  attachments?: string[];
}

export interface AgentSessionActivity {
  sessionId: string;
  running: boolean;
  turns: number;
  queue: number;
  approvals: number;
  jobs: number;
  state?: SessionState | undefined;
}

export interface AgentRisk {
  id: string;
  label: string;
  detail: string;
}

export type AgentPendingApproval = SessionState["approvals"][number];

export interface AgentRestoreResult {
  id: string;
  target: "before" | "after";
  restored: string[];
  removed: string[];
  unchanged: string[];
  skipped: Array<{ path: string; reason: "conflict" | "protected" }>;
}

export interface AgentApproval {
  id: string;
  createdAt: number;
  request: {
    action: string;
    tool: string;
    target?: string;
    path?: string;
    cwd: string;
    reason?: string;
    sessionId?: string;
    paths?: string[];
    risks?: AgentRisk[];
  };
  reason?: string;
}

export interface AgentCheckpoint {
  id: string;
  createdAt: string;
  label: string;
  tool: string;
  sessionId?: string;
  files: Array<{ path: string; beforeHash?: string; afterHash?: string; mode?: number }>;
  bytes: number;
  finalizedAt?: string;
  /** Shell command behind the changes, for bash, terminal and background jobs. */
  command?: string;
  /** Changes the snapshot saw but could not keep within its limits. */
  gap?: { files: number; bytes: number; reason: string };
}

/** `files.read`: one project file or tool log, bounded and redacted by the core. */
export interface AgentFilePreview {
  path: string;
  size: number;
  text: string;
  truncated: boolean;
  binary: boolean;
  hash?: string;
  readOnlyReason?: string;
}

export interface AgentToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface AgentToolResult {
  ok: boolean;
  output: string;
  /** Repair notes the model reads before the output. */
  notice?: string;
  /** Exit code, duration and full-log path the model reads after the output. */
  trailer?: string;
  provenance?: { source: "file" | "web" | "mcp" | "shell"; ref?: string };
  error?: string;
  fullOutputPath?: string;
  durationMs?: number;
  terminate?: boolean;
  data?: unknown;
}

export interface AgentRunResult {
  sessionId: string;
  pass: boolean;
  stopReason: "done" | "end" | "stopped" | "error" | "max_turns" | "budget";
  summary: string;
  turns: number;
  usage: AgentUsage;
  budget?: AgentBudget;
}

/** Internal model context; the transcript need not render a second user message. */
export interface AgentMemoryContext {
  type: "memory.context";
  sessionId: string;
  text: string;
  references: { id: string; revision: number; level: "index" | "full" | "invalidated" }[];
}
