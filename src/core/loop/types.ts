import type { CompactionState, ContextSummary } from "../../context";
import type { ModelProvider } from "../../providers/types";
import type { ToolRegistry } from "../../tools/registry";
import type { ToolContext } from "../../tools/types";
import type { LanguageRun } from "../../translation/run";
import type { AttachmentReference } from "../attachment-reference";
import type { DictionaryRuntime } from "../dictionary/runtime";
import type { RetryPolicy } from "../goal/retry";
import type { GoalState } from "../goal/state";
import type { RetryFailureKind } from "../goal/types";
import type { HookRunner } from "../hooks/runner";
import type { HookRun } from "../hooks/types";
import type { MemoryDelivery } from "../memory/command";
import type { MemoryRuntime } from "../memory/runtime";
import type { PageWriter } from "../pages/writer";
import type { ImagePart, Message, ReasoningEffort, ToolCall, ToolResult, Usage } from "../types";
import type { ToolCalls } from "./calls";
import type { CompactionRequest } from "./context";

export type LoopEvent =
  | ({ type: "memory.context" } & MemoryDelivery)
  | { type: "translation.failed"; message: string }
  | { type: "turn.started"; turn: number }
  | { type: "message.started" }
  | { type: "message.delta"; text: string }
  | { type: "reasoning.delta"; text: string }
  | {
      type: "message.finished";
      text: string;
      reasoning: string;
      toolCalls: ToolCall[];
      providerData?: unknown;
      summary?: string;
      complete?: boolean;
      display?: { text: string; reasoning: string; summary?: string };
    }
  | { type: "message.reset"; reason: string }
  | {
      /** A fallback model answers this request because the configured one failed. */
      type: "model.fallback";
      provider: string;
      model: string;
      reason: string;
    }
  | {
      type: "provider.retry";
      kind: RetryFailureKind;
      attempt: number;
      delayMs: number;
      /** Epoch ms when the next request goes out. */
      until: number;
      reason: string;
    }
  | {
      type: "tool_call.progress";
      index: number;
      name?: string;
      delta?: string;
    }
  | { type: "tool.output"; callId: string; text: string }
  | { type: "tool.started"; call: ToolCall }
  | { type: "tool.finished"; call: ToolCall; result: ToolResult }
  | {
      type: "steer.applied";
      text: string;
      input?: string;
      queueId?: string;
      attachments?: AttachmentReference[];
    }
  | {
      type: "notice.applied";
      text: string;
      moduleReferences?: import("../../../shared/modules").ModuleReference[];
      attachments?: AttachmentReference[];
    }
  | {
      type: "context.compacted";
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
      used: number;
      window: number;
      reserve: number;
      source: "estimate" | "provider";
    }
  | {
      type: "usage";
      usage: Usage;
      purpose?: "translation" | "vision";
      provider?: string;
      model?: string;
      durationMs?: number;
    }
  | { type: "hook.finished"; hook: HookRun }
  | { type: "turn.finished"; turn: number; reason: string };

export interface LoopOptions {
  /** Logical page checkpoints apply only to the execution Worker. */
  role?: "talker" | "worker";
  loadMedia?(references: AttachmentReference[]): Promise<ImagePart[]>;
  modules?: import("../modules/types").ModuleSessionPort;
  provider: ModelProvider;
  memory?: MemoryRuntime;
  dictionary?: DictionaryRuntime;
  /** Actual human input, absent for internal and delegated prompts. */
  userSource?: string;
  allowUserMemory?: boolean;
  language?: LanguageRun | undefined;
  tools: ToolRegistry;
  system: string;
  responseFormat?: "summary" | "structured" | "conversation";
  signal: AbortSignal;
  /** Finish in-flight work, close tool results, then stop before another request. */
  stopSignal?: AbortSignal;
  emit(event: LoopEvent): void;
  messages?: Message[];
  attachments?: ImagePart[];
  takeSteering?: () => Promise<SteeringMessage[]>;
  /** Running calls, so the user can cancel one of them from its card. */
  calls?: ToolCalls;
  /** Text of the limit that is used up; the loop stops before the next model request. */
  budgetExhausted?: () => string | undefined;
  compactionState?: CompactionState;
  /** Worker-written pages at compaction boundaries; deterministic pages when absent. */
  pageWriter?: PageWriter;
  /** Manual compaction from the meter or `/compact`, applied before the next request. */
  takeCompactionRequest?: () => CompactionRequest | undefined;
  retryPolicy?: RetryPolicy;
  /** Zero runs until completion, cancellation or an explicit budget. */
  maxTurns: number;
  maxTokens: number;
  contextWindow: number;
  reserveTokens: number;
  reasoning?: ReasoningEffort;
  variant?: string;
  continuations: number;
  parallelTools: boolean;
  hooks?: HookRunner;
  goal?: GoalState;
  toolContext: Omit<ToolContext, "signal">;
}

export interface SteeringMessage {
  text: string;
  /** A harness notice (finished job) instead of a message the user typed. */
  kind?: "notice";
  queueId?: string;
  /** What the user typed, shown in the thread; text may also carry attachment blocks. */
  display?: string;
  attachments?: ImagePart[];
  attachmentRefs?: AttachmentReference[];
}

export interface LoopResult {
  stopReason: "done" | "end" | "stopped" | "max_turns" | "budget";
  summary: string;
  turns: number;
  usage: Usage;
  done?: { summary: string; evidence: string[] };
  lastText: string;
  messages: Message[];
}
