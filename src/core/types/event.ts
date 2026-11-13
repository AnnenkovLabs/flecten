import type { SessionState } from "../../../shared/session-state";
import type { SubagentEnvelope } from "../../../shared/subagents";
import type { TwinActivity } from "../../../shared/twin-activity";
import type { ContextSummary } from "../../context";
import type { ApprovalChoice, PermissionAction, PermissionRisk } from "../../security/types";
import type { JobView } from "../../tools/jobs/view";
import type { AttachmentReference } from "../attachment-reference";
import type { HookRun } from "../hooks/types";
import type { MemoryDelivery } from "../memory/command";
import type { PromptStamp } from "../prompt";
import type { SessionId } from "./ids";
import type { Usage } from "./message";
import type { ReasoningEffort } from "./reasoning";
import type { BudgetView, RunResult } from "./session";
import type { ToolCall, ToolResult } from "./tool";

export type Event =
  | SessionEvent
  | { type: "worker.event"; sessionId: SessionId; event: SessionEvent };
export type SessionEvent = LeafSessionEvent | SubagentEnvelope<LeafSessionEvent>;
export type LeafSessionEvent =
  | { type: "twin.activity"; sessionId: SessionId; activity: TwinActivity }
  | {
      type: "memory.context";
      sessionId: SessionId;
      text: MemoryDelivery["text"];
      references: MemoryDelivery["references"];
    }
  | {
      type: "input.translated";
      sessionId: SessionId;
      input: string;
      language: string;
      system?: PromptStamp;
    }
  | { type: "translation.failed"; sessionId: SessionId; message: string }
  | { type: "session.state"; sessionId: SessionId; state: SessionState }
  | {
      type: "session.started";
      sessionId: SessionId;
      provider: string;
      model: string;
      role?: "talker" | "worker";
      prompt: string;
      /** Exact text the model received when it differs from the prompt (slash expansion, attachments, memory). */
      input?: string;
      attachments?: AttachmentReference[];
      reasoning?: ReasoningEffort;
      /** Version, hash and budget of the system prompt this run used. */
      system?: PromptStamp;
      /** Queue item this run came from; a restored queue never sends it again. */
      queueId?: string;
      /** The run continues a task that a crash or restart interrupted. */
      resumed?: boolean;
      internal?: boolean;
      budget?: BudgetView;
    }
  | { type: "turn.started"; sessionId: SessionId; turn: number }
  /** Durable position of the first visible text fragment, before concurrent Worker calls. */
  | { type: "message.started"; sessionId: SessionId }
  | { type: "message.delta"; sessionId: SessionId; text: string }
  | { type: "reasoning.delta"; sessionId: SessionId; text: string }
  | {
      type: "message.finished";
      sessionId: SessionId;
      text: string;
      reasoning: string;
      toolCalls: ToolCall[];
      /** Opaque native response metadata needed to continue the same provider conversation. */
      providerData?: unknown;
      summary?: string;
      complete?: boolean;
      display?: { text: string; reasoning: string; summary?: string };
    }
  | { type: "message.reset"; sessionId: SessionId; reason: string }
  | {
      /** Failover: a fallback model answers because the configured one failed with `reason`. */
      type: "model.fallback";
      sessionId: SessionId;
      provider: string;
      model: string;
      reason: string;
    }
  | {
      /** The request failed and goes out again at `until`; transient, never written to disk. */
      type: "provider.retry";
      sessionId: SessionId;
      kind: string;
      attempt: number;
      delayMs: number;
      until: number;
      reason: string;
    }
  | {
      type: "tool_call.progress";
      sessionId: SessionId;
      index: number;
      name?: string;
      delta?: string;
    }
  | { type: "tool.output"; sessionId: SessionId; callId: string; text: string }
  | { type: "tool.started"; sessionId: SessionId; call: ToolCall }
  | {
      type: "tool.finished";
      sessionId: SessionId;
      call: ToolCall;
      result: ToolResult;
    }
  | {
      type: "steer.applied";
      sessionId: SessionId;
      text: string;
      input?: string;
      attachments?: AttachmentReference[];
      queueId?: string;
    }
  | {
      /** A harness notice reached the model, for example a finished background job. */
      type: "notice.applied";
      sessionId: SessionId;
      text: string;
      moduleReferences?: import("../../../shared/modules").ModuleReference[];
      attachments?: AttachmentReference[];
    }
  | { type: "job.started"; sessionId: SessionId; job: JobView }
  | {
      type: "job.finished";
      sessionId: SessionId;
      job: JobView;
      /** The user asked to hear about finished jobs (terminal.notifyOnExit). */
      notify: boolean;
      checkpoint?: unknown;
    }
  | { type: "budget"; sessionId: SessionId; budget: BudgetView }
  | {
      /** The sidecar stopped while this run was active; the run can be resumed. */
      type: "run.interrupted";
      sessionId: SessionId;
      at: number;
      reason: string;
    }
  | {
      type: "context.compacted";
      sessionId: SessionId;
      summary: string;
      displaySummary?: string;
      contextSummary?: ContextSummary;
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
      type: "context.usage";
      sessionId: SessionId;
      used: number;
      window: number;
      reserve: number;
      source: "estimate" | "provider";
    }
  | {
      type: "usage";
      sessionId: SessionId;
      usage: Usage;
      purpose?: "translation" | "vision";
      provider?: string;
      model?: string;
      durationMs?: number;
    }
  | { type: "hook.finished"; sessionId: SessionId; hook: HookRun }
  | {
      type: "turn.finished";
      sessionId: SessionId;
      turn: number;
      reason: string;
    }
  | { type: "session.finished"; sessionId: SessionId; result: RunResult }
  | {
      /** A tool call waits for the user's answer; it is denied at `expiresAt`. */
      type: "approval.requested";
      sessionId: SessionId;
      approval: PendingApprovalView;
    }
  | {
      type: "approval.resolved";
      sessionId: SessionId;
      id: string;
      choice: ApprovalChoice;
      by: "user" | "timeout" | "aborted" | "policy" | "persistence";
      feedback?: string;
    }
  | {
      type: "error";
      sessionId?: SessionId;
      code: string;
      message: string;
      /** Set when a provider limit ended the run. */
      limit?: "rate" | "five_hour" | "weekly" | "billing";
      resetAt?: number;
    };

export type EventType = Event["type"];

export interface PendingApprovalView {
  humanOnly?: boolean;
  id: string;
  action: PermissionAction;
  tool: string;
  target: string;
  reason: string;
  risks?: PermissionRisk[];
  callId?: string;
  createdAt: number;
  expiresAt: number;
  cwd?: string;
  paths?: string[];
  requestReason?: string;
  grantLabel?: string;
  actor?: string;
  arguments?: Array<{ name: string; value: string }>;
}
