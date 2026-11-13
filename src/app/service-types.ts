import type { UpdateSettings } from "../../shared/update-settings.cjs";
import type { SlashEntry } from "../commands/custom";
import type { HarnessConfig, ProviderConfig } from "../config/schema";
import type { PromptStamp } from "../core/prompt";
import type { Event, ReasoningEffort } from "../core/types";
import type { McpServerStatus } from "../mcp/session";
import type { CatalogProvider, CatalogStatus } from "../providers/catalog";
import type { DiscoverResult } from "../providers/discovery";
import type { ProbeResult } from "../providers/probe";
import type { SandboxDetection } from "../security/os-sandbox";
import type { SkillDiagnostic } from "../skills/schema";
import type { ForkSessionOptions, SessionListOptions, SessionSummary } from "../store/events/index";
import type { ProviderView } from "./provider-state";
import type { SessionPool } from "./session-pool";

export interface AppInfo {
  configPath?: string;
  cwd: string;
  project: string;
  branch: string;
  user: string;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  ui?: HarnessConfig["ui"];
  update: UpdateSettings;
  providers: ProviderView[];
  reasoning?: ReasoningEffort;
  variant?: string;
  cost?: number;
  secretBackend: string;
  catalog?: CatalogStatus;
  configError?: string;
  trustRequired: boolean;
  trustAccepted: boolean;
  skills: {
    count: number;
    names: string[];
    diagnostics: SkillDiagnostic[];
  };
  mcp: {
    tools: number;
    servers: McpServerStatus[];
  };
  sandbox: {
    enabled: boolean;
    kind: SandboxDetection["kind"];
    available: boolean;
    reason: string;
    warning?: string;
  };
  memory: {
    records: number;
  };
  /** Version, hash and budget of the system prompt the next run uses. */
  system: PromptStamp;
  /** Snapshots around shell commands: ready, still indexing, off in settings, or broken. */
  shellCheckpoints: ShellCheckpointState;
}

export interface ShellCheckpointState {
  state: "ready" | "indexing" | "off" | "unavailable";
  reason?: string;
}

export interface SettingsPayload {
  config: HarnessConfig;
  info: AppInfo;
}

export interface CatalogSummary {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  apiKeyEnv?: string;
  modelCount: number;
}

export interface SaveSettingsInput {
  config: unknown;
  clearApiKeys?: string[];
}

export interface ModelChoiceInput {
  provider: string;
  model: string;
  reasoning?: ReasoningEffort;
  variant?: string;
}

export interface AppService {
  twin: Awaited<ReturnType<typeof import("./twin").projectTwin>>;
  dictionary: Awaited<ReturnType<typeof import("./dictionary").projectDictionary>>;
  modules: ReturnType<typeof import("./modules").moduleService>;
  ideTerminal: import("./ide-terminal").IdeTerminal;
  testHook(input: unknown): ReturnType<typeof import("./hook-test").testHook>;
  extensions: import("./extension-runtime").ExtensionRuntime;
  reloadSkills(): ReturnType<import("./extension-runtime").ExtensionRuntime["skills"]>;
  voice: ReturnType<typeof import("./voice").voiceService>;
  /** Every task has its own handle; commands name their session or go to the focused one. */
  session: SessionPool;
  info(): AppInfo;
  /** Custom slash commands and skills for the composer menu. */
  listCommands(): Promise<SlashEntry[]>;
  settings(): SettingsPayload;
  saveSettings(input: SaveSettingsInput): Promise<AppInfo>;
  setModel(input: ModelChoiceInput): Promise<AppInfo>;
  listSessions(options?: SessionListOptions): Promise<SessionSummary[]>;
  searchSessions(
    query: string,
    options?: Omit<SessionListOptions, "query">,
  ): Promise<SessionSummary[]>;
  readSession(id: string): Promise<Event[]>;
  renameSession(id: string, title: string): Promise<SessionSummary>;
  deleteSession(
    id: string,
    input?: { confirm?: boolean } | boolean,
  ): Promise<{ id: string; trash: string }>;
  forkSession(id: string, options?: ForkSessionOptions): Promise<SessionSummary>;
  discover(input: {
    protocol: ProviderConfig["protocol"];
    baseUrl: string;
    apiKey?: string;
    headers?: Record<string, string>;
  }): Promise<DiscoverResult>;
  test(input: { model: string; providerId?: string; draftToken?: string }): Promise<{
    ok: boolean;
    message: string;
    latencyMs: number;
  }>;
  registerDraft(input: { provider: unknown; providerId?: string }): { draftToken: string };
  acceptTrust(): Promise<AppInfo>;
  catalogList(): Promise<CatalogSummary[]>;
  catalogProvider(id: string): Promise<CatalogProvider | undefined>;
  catalogStatus(): Promise<CatalogStatus>;
  catalogSync(): Promise<CatalogStatus>;
  actualizeProvider(id: string): Promise<{
    providerId: string;
    info: AppInfo;
    models: number;
    added: string[];
    updated: string[];
    removed: string[];
    warnings: string[];
    probedModel: string;
    probe: ProbeResult;
  }>;
  probeModel(id: string, model: string): Promise<{ result: ProbeResult; info: AppInfo }>;
  /**
   * Marks runs the previous process left mid-way as interrupted and resumes them once
   * (sessions.autoResume). Called after the UI subscribed, so it sees the resumed runs.
   */
  resumeInterrupted(): Promise<{ interrupted: string[]; resumed: string[] }>;
  dispose(): Promise<void>;
}
