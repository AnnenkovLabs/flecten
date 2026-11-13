import type { SessionState } from "../../../shared/session-state";
import type { TerminalManager } from "../../terminal/manager";
import type { AttachmentSnapshot } from "../attachment-reference";
import type { ContextReference } from "../context-reference";
import type { GoalState } from "../goal/state";
import type { ToolCalls } from "../loop/calls";
import type { RunQueue } from "../queue/queue";
import type { SteeringController } from "../queue/steering";
import type { SubagentTasks } from "../subagents/tasks";
import type { Event, Message, SessionId, Usage } from "../types";
import type { ApprovalWaiters } from "./approvals";
import type { RunBudget } from "./budget";
import type { SessionCompaction } from "./compaction";
import type { SessionOptions } from "./options";

export interface RunExtras {
  queueId?: string;
  resumed?: boolean;
  internal?: boolean;
  contexts?: ContextReference[];
  attachmentSnapshot?: AttachmentSnapshot;
}

export interface ActiveRun {
  sessionId: SessionId;
  controller: AbortController;
  stop: AbortController;
  turns: number;
  usage: Usage;
  budget: RunBudget;
}

/** What the command dispatcher may read and change inside one session handle. */
export interface SessionRuntime {
  readonly options: SessionOptions;
  readonly queue: RunQueue;
  readonly steering: SteeringController;
  readonly approvals: ApprovalWaiters;
  readonly compaction: SessionCompaction;
  readonly calls: ToolCalls;
  readonly subagents: SubagentTasks;
  readonly terminals: TerminalManager;
  active(): ActiveRun | undefined;
  busy(): boolean;
  state(): SessionState | undefined;
  sessionId(): SessionId | undefined;
  reserveSessionId(): SessionId;
  history(): Message[];
  goal(): GoalState | undefined;
  emit(event: Event): void;
  saveQueue(): Promise<void>;
}
