import type { DictionaryEntry, DictionarySnapshot } from "../../../shared/dictionary";
import type { SessionState } from "../../../shared/session-state";
import type { SubagentEnvelope } from "../../../shared/subagents";
import type { TwinAnswer, TwinSnapshot } from "../../../shared/twin";
import type { AgentMemoryContext, AgentNotice } from "./agent-types";
import type { ContextReference } from "./composer/context-types";
import type { ModuleCommand, ModuleResponse } from "./modules/protocol";
import type { LimitKind } from "./run-errors";
import type {
  AgentBudget,
  AgentCheckpoint,
  AgentFilePreview,
  AgentInfo,
  AgentJob,
  AgentPendingApproval,
  AgentPromptStamp,
  AgentRestoreResult,
  AgentRunResult,
  AgentSessionSummary,
  AgentToolCall,
  AgentToolResult,
  AgentUsage,
  CatalogProviderInfo,
  CatalogStatus,
  CatalogSummary,
  DiscoverResult,
  HarnessSettings,
  ProbeResult,
  ProviderActualizeResult,
  ProviderProtocol,
  ProviderSettings,
  ProviderTestResult,
  ReasoningEffort,
} from "./types";
export type ContextSource = "estimate" | "provider";
export interface ContextUsage {
  used: number;
  window: number;
  reserve: number;
  source: ContextSource;
}
export interface CustomCommandInfo {
  name: string;
  description?: string;
  hint?: string;
  source: "command" | "skill";
}

export interface AgentReplay {
  sessionId: string;
  events: AgentEvent[];
  seq: number;
  running: boolean;
}

export type AgentEvent = AgentEventBody & {
  seq?: number;
  timestamp?: number;
  reasoningStartedAt?: number;
};

type AgentEventBody =
  | AgentLeafEvent
  | SubagentEnvelope<AgentChildEvent>
  | { type: "worker.event"; sessionId: string; event: WorkerSessionEvent };
type AgentChildEvent = Extract<AgentLeafEvent, { sessionId?: string }>;
type AgentLeafEvent =
  | import("../../../shared/twin-activity").TwinActivityEvent
  | { type: "session.state"; sessionId: string; state: SessionState }
  | {
      type: "session.started";
      sessionId: string;
      provider: string;
      model: string;
      prompt?: string;
      role?: "talker" | "worker";
      reasoning?: ReasoningEffort;
      system?: AgentPromptStamp;
      queueId?: string;
      resumed?: boolean;
      internal?: boolean;
      budget?: AgentBudget;
    }
  | AgentMemoryContext
  | AgentNotice
  | { type: "job.started"; sessionId: string; job: AgentJob }
  | {
      type: "job.finished";
      sessionId: string;
      job: AgentJob;
      notify: boolean;
      /** Set when the job's file changes were saved as a checkpoint. */
      checkpoint?: unknown;
    }
  | { type: "budget"; sessionId: string; budget: AgentBudget }
  | { type: "run.interrupted"; sessionId: string; at: number; reason: string }
  | { type: "approval.requested"; sessionId: string; approval: AgentPendingApproval }
  | {
      type: "approval.resolved";
      sessionId: string;
      id: string;
      choice: "allow_once" | "allow_session" | "allow_always" | "deny";
      by: "user" | "timeout" | "aborted" | "policy" | "persistence";
    }
  | { type: "sessions.interrupted"; interrupted: string[]; resumed: string[] }
  | { type: "turn.started"; sessionId: string; turn: number }
  | { type: "input.translated"; sessionId: string; input: string; language: string }
  | { type: "translation.failed"; sessionId: string; message: string }
  | { type: "message.started"; sessionId: string }
  | { type: "message.delta"; sessionId: string; text: string }
  | { type: "reasoning.delta"; sessionId: string; text: string }
  | {
      type: "message.finished";
      sessionId: string;
      text: string;
      reasoning: string;
      toolCalls: AgentToolCall[];
      summary?: string;
      complete?: boolean;
      display?: { text: string; reasoning: string; summary?: string };
    }
  | { type: "message.reset"; sessionId: string; reason: string }
  | { type: "model.fallback"; sessionId: string; provider: string; model: string; reason: string }
  | {
      type: "provider.retry";
      sessionId: string;
      kind: string;
      attempt: number;
      delayMs: number;
      until: number;
      reason: string;
    }
  | {
      type: "tool_call.progress";
      sessionId: string;
      index: number;
      name?: string;
      delta?: string;
    }
  | { type: "tool.output"; sessionId: string; callId: string; text: string }
  | { type: "tool.started"; sessionId: string; call: AgentToolCall }
  | {
      type: "tool.finished";
      sessionId: string;
      call: AgentToolCall;
      result: AgentToolResult;
    }
  | { type: "steer.applied"; sessionId: string; text: string; queueId?: string }
  | {
      type: "context.compacted";
      sessionId: string;
      summary: string;
      displaySummary?: string;
      pruned: number;
      before?: number;
      after?: number;
      kept?: number;
      page?: number;
      path?: string;
      source?: "model" | "deterministic";
      focus?: string;
    }
  | {
      type: "usage";
      sessionId: string;
      usage: AgentUsage;
      provider?: string;
      model?: string;
      purpose?: "translation" | "vision";
    }
  | ({ type: "context.usage"; sessionId: string } & ContextUsage)
  | {
      type: "hook.finished";
      sessionId: string;
      hook: import("../../../shared/hooks").HookRun;
    }
  | { type: "turn.finished"; sessionId: string; turn: number; reason: string }
  | { type: "session.finished"; sessionId: string; result: AgentRunResult }
  | {
      type: "error";
      sessionId?: string;
      code: string;
      message: string;
      limit?: LimitKind;
      resetAt?: number;
    }
  | (ModuleResponse & {
      type: "response";
      directories?: string[];
      dictionary?: DictionarySnapshot;
      twin?: TwinSnapshot;
      answer?: TwinAnswer;
      search?: unknown;
      replacement?: unknown;
      git?: unknown;
      terminal?: unknown;
      requestId: string;
      ok: boolean;
      error?: string;
      text?: string;
      diagnostics?: { path: string; report: unknown };
      exported?: { path: string };
      hookTest?: import("../../../shared/hooks").HookTestResult;
      mcp?: import("./settings/extension-types").McpStatus;
      skills?: import("./settings/extension-types").SkillMetadata[];
      resource?: { name: string; path: string; text: string; truncated: boolean };
      authorization?: { server: string; url?: string; state: "pending" | "authorized" };
      contextReference?: ContextReference;
      attachedContext?: import("./settings/extension-types").ExtensionContext;
      voice?: import("./voice-settings").VoiceDestination & { provider: string };
      voiceSetup?: { ready: boolean; message: string };
      settings?: { config: HarnessSettings; info: AgentInfo };
      providers?: CatalogSummary[];
      provider?: CatalogProviderInfo;
      status?: CatalogStatus;
      result?: DiscoverResult | ProviderTestResult | ProbeResult | ProviderActualizeResult;
      files?: string[];
      file?: AgentFilePreview;
      commands?: CustomCommandInfo[];
      context?: ContextUsage;
      /** context.compact: applied now (idle) or scheduled before the next request (busy). */
      compacted?: boolean;
      scheduled?: boolean;
      checkpoints?: AgentCheckpoint[];
      info?: AgentInfo;
      sessions?: AgentSessionSummary[];
      session?: AgentSessionSummary;
      events?: AgentEvent[];
      replay?: AgentReplay;
      restore?: AgentRestoreResult;
      jobs?: AgentJob[];
      job?: AgentJob | null;
      /** status with a sessionId: that task's run, queue, approvals and jobs. */
      state?: AgentInfo;
      approval?: { id: string; choice: "allow_once" | "allow_session" | "allow_always" | "deny" };
    })
  | ({ type: "status" } & AgentInfo)
  | { type: "agent.exit"; code: number | null; signal?: string; message?: string }
  | { type: "project.changed"; cwd: string }
  | { type: "session.open"; id: string };

export type AgentCommand =
  | ModuleCommand
  | import("../../../shared/twin-protocol").TwinCommand
  | { type: "dictionary.list" | "dictionary.sync"; requestId: string }
  | {
      type: "dictionary.save";
      requestId: string;
      entry: DictionaryEntry;
      expectedRevision?: number;
    }
  | { type: "dictionary.forget"; requestId: string; id: string; expectedRevision: number }
  | { type: "diagnostics.export" | "telemetry.send"; requestId: string }
  | {
      type: "hooks.test";
      requestId: string;
      event: keyof import("./types").HooksSettings;
      index?: number;
      toolName?: string;
      hook?: import("./types").HookCommandSettings;
      sample?: import("../../../shared/hooks").HookSample;
    }
  | { type: "mcp.status" | "skills.list" | "skills.reload"; requestId: string }
  | { type: "skills.resource"; name: string; path: string; requestId: string }
  | { type: "mcp.reconnect"; requestId: string; id?: string }
  | { type: "mcp.oauth.start" | "mcp.oauth.cancel"; requestId: string; id: string }
  | {
      type: "mcp.elicitation.respond";
      requestId: string;
      id: string;
      response: {
        action: "accept" | "decline" | "cancel";
        content?: Record<string, import("./settings/extension-types").ElicitationValue>;
      };
    }
  | { type: "mcp.resource"; requestId: string; server: string; uri: string }
  | {
      type: "mcp.prompt";
      requestId: string;
      server: string;
      name: string;
      args?: Record<string, string>;
    }
  | { type: "voice.status"; requestId: string }
  | {
      type: "voice.transcribe";
      requestId: string;
      id: string;
      audio: string;
      mimeType: string;
      destination?: import("./voice-settings").VoiceDestination;
    }
  | { type: "voice.cancel"; requestId: string; id: string }
  | {
      type: "voice.check" | "voice.prepare";
      requestId: string;
      id: string;
      engine: "faster-whisper" | "vosk";
      local: import("./voice-settings").LocalVoiceOptions;
    }
  | {
      type: "run";
      prompt: string;
      reasoning?: ReasoningEffort;
      sessionId?: string;
      attachments?: string[];
      contexts?: ContextReference[];
      /** Id of this send; the same id twice starts one run. */
      clientId?: string;
      resumed?: boolean;
      internal?: boolean;
    }
  | {
      type: "stop";
      requestId: string;
      sessionId?: string;
      mode?: "graceful" | "force";
      target?: "worker";
    }
  | { type: "status" }
  | { type: "status"; requestId: string; sessionId: string }
  | {
      type: "steer";
      requestId: string;
      sessionId?: string;
      id?: string;
      text: string;
      attachments?: string[];
      contexts?: ContextReference[];
    }
  | {
      type: "queue.add";
      requestId: string;
      sessionId?: string;
      id?: string;
      text: string;
      attachments?: string[];
      contexts?: ContextReference[];
    }
  | { type: "queue.edit"; requestId: string; sessionId?: string; id: string; text: string }
  | { type: "queue.remove"; requestId: string; sessionId?: string; id: string }
  | {
      type: "approval.respond";
      requestId: string;
      sessionId?: string;
      id: string;
      decision: "allow_once" | "allow_session" | "allow_always" | "deny";
      feedback?: string;
    }
  | { type: "approval.allowAll"; requestId: string; sessionId?: string; ids: string[] }
  | { type: "approval.denyAll"; requestId: string; sessionId?: string; ids: string[] }
  | { type: "tool.cancel"; requestId: string; sessionId?: string; callId: string }
  | { type: "subagent.stop"; requestId: string; sessionId?: string; id: string }
  | { type: "jobs.list"; requestId: string; sessionId?: string }
  | { type: "jobs.stop"; requestId: string; sessionId?: string; id: string }
  | { type: "events.replay"; requestId: string; sessionId: string }
  | {
      type: "files.change";
      requestId: string;
      operation: "create";
      path: string;
      directory: boolean;
    }
  | {
      type: "files.change";
      requestId: string;
      operation: "rename";
      path: string;
      destination: string;
    }
  | { type: "files.change"; requestId: string; operation: "trash"; path: string; confirm: true }
  | {
      type: "files.search";
      requestId: string;
      query: string;
      caseSensitive: boolean;
      wholeWord: boolean;
      include: string;
    }
  | {
      type: "ide.terminal";
      requestId: string;
      action: "read" | "write" | "resize" | "restart" | "stop";
      data?: string;
      cursor?: number;
      cols?: number;
      rows?: number;
    }
  | { type: "files.git"; requestId: string; action: "status" }
  | { type: "files.git"; requestId: string; action: "diff"; path: string; staged: boolean }
  | { type: "files.git"; requestId: string; action: "stage" | "unstage"; path: string }
  | { type: "files.git"; requestId: string; action: "commit"; message: string }
  | {
      type: "files.replace";
      requestId: string;
      action: "preview" | "apply";
      query: string;
      caseSensitive: boolean;
      wholeWord: boolean;
      include: string;
      replacement: string;
      files?: Array<{ path: string; expectedHash: string; count: number }>;
    }
  | { type: "files.list"; requestId: string }
  | { type: "files.read"; requestId: string; path: string }
  | { type: "files.write"; requestId: string; path: string; text: string; expectedHash: string }
  | { type: "commands.list"; requestId: string }
  | { type: "context.pull-request"; requestId: string; url: string }
  | { type: "context.compact"; requestId: string; sessionId?: string; focus?: string }
  | { type: "checkpoint.list"; requestId: string }
  | { type: "checkpoint.diff"; requestId: string; id: string }
  | {
      type: "checkpoint.restore";
      requestId: string;
      id: string;
      target?: "before" | "after";
      force?: boolean;
      includeProtected?: boolean;
      paths?: string[];
    }
  | { type: "hello" }
  | {
      type: "sessions.list";
      requestId: string;
      query?: string;
      limit?: number;
      offset?: number;
    }
  | {
      type: "sessions.search";
      requestId: string;
      query: string;
      limit?: number;
      offset?: number;
    }
  | { type: "sessions.get"; requestId: string; id: string }
  | { type: "sessions.rename"; requestId: string; id: string; title: string }
  | { type: "sessions.delete"; requestId: string; id: string; confirm: true }
  | { type: "sessions.export"; requestId: string; id: string }
  | {
      type: "sessions.fork";
      requestId: string;
      id: string;
      sequence?: number;
      turn?: number;
    }
  | { type: "settings.get"; requestId: string }
  | {
      type: "settings.save";
      requestId: string;
      config: HarnessSettings;
      clearApiKeys?: string[];
    }
  | { type: "catalog.list"; requestId: string }
  | { type: "catalog.provider"; requestId: string; id: string }
  | { type: "catalog.status"; requestId: string }
  | { type: "catalog.sync"; requestId: string }
  | { type: "provider.actualize"; requestId: string; id: string }
  | { type: "provider.reauthorize"; requestId: string; id: string; model: string }
  | { type: "model.probe"; requestId: string; provider: string; model: string }
  | {
      type: "provider.discover";
      requestId: string;
      protocol: ProviderProtocol;
      baseUrl: string;
      apiKey?: string;
      headers?: Record<string, string>;
    }
  | {
      type: "provider.test";
      requestId: string;
      model: string;
      providerId?: string;
      draftToken?: string;
    }
  | { type: "provider.draft"; requestId: string; provider: ProviderSettings; providerId?: string }
  | {
      type: "model.set";
      requestId: string;
      provider: string;
      model: string;
      reasoning?: ReasoningEffort;
      variant?: string;
    };

export type WorkerSessionEvent = AgentChildEvent | SubagentEnvelope<AgentChildEvent>;
