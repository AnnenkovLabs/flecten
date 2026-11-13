import continueEmpty from "../../../prompts/loop/continue-empty.md" with { type: "text" };
import continueGoal from "../../../prompts/loop/continue-goal.md" with { type: "text" };
import continueLength from "../../../prompts/loop/continue-length.md" with { type: "text" };
import continueProtocol from "../../../prompts/loop/continue-protocol.md" with { type: "text" };
import truncatedCall from "../../../prompts/loop/truncated-call.md" with { type: "text" };
import { LimitError } from "../../errors";
import { isObject } from "../../util/json";
import { parseCompletionSignal } from "../goal/completion";
import type { GoalState } from "../goal/state";
import type { CompletionSignal, GoalTodo, RetryDecision, RetryFailure } from "../goal/types";
import { deliverModules } from "../modules/delivery";
import type { AssistantMessage, Message, ToolResult, Usage } from "../types";
import { compactContextIfNeeded } from "./context";
import { type StreamedTurn, streamAssistant } from "./stream";
import type { LoopEvent, LoopOptions } from "./types";

export const CONTINUE_LENGTH = continueLength.trim();
export const CONTINUE_EMPTY = continueEmpty.trim();
export const CONTINUE_PROTOCOL = continueProtocol.trim();
export const TRUNCATED_CALL = truncatedCall.trim();
const CONTINUE_GOAL = continueGoal.trim();
const GOAL_NO_PROGRESS_LIMIT = 3;

export interface DoneResult {
  summary: string;
  evidence: string[];
}

export function continueGoalMessage(goal: GoalState): string {
  const remaining = goal
    .remainingCriteria()
    .map((criterion, index) => `${index + 1}. ${criterion}`);
  return [CONTINUE_GOAL, ...remaining].join("\n");
}

export function goalTodosOf(data: unknown): GoalTodo[] | undefined {
  if (!isObject(data) || data.kind !== "todo" || !Array.isArray(data.todos)) return undefined;
  const todos: GoalTodo[] = [];
  for (const entry of data.todos) {
    if (!isObject(entry)) return undefined;
    if (typeof entry.content !== "string" || typeof entry.status !== "string") return undefined;
    todos.push({ content: entry.content, status: entry.status });
  }
  return todos;
}

export function blockGoal(goal: GoalState | undefined, reason: string): void {
  if (goal?.status === "active") goal.markBlocked(reason);
}

function budgetAllowsWait(goal: GoalState | undefined, delayMs: number): boolean {
  if (goal?.budget.maxDurationMs === undefined) return true;
  return goal.elapsedMs() + delayMs <= goal.budget.maxDurationMs;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      Math.max(0, ms),
    );
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Deltas reached the UI, so a retry has to clear the partial answer first. */
function streamed(event: LoopEvent): boolean {
  return (
    event.type === "message.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "tool_call.progress"
  );
}

const LIMIT_OF: Partial<Record<RetryFailure["kind"], LimitError["limit"]>> = {
  rate_limit: "rate",
  quota_5h: "five_hour",
  quota_weekly: "weekly",
  billing: "billing",
};

/** A limit that ends the run carries its kind and reset time to the UI. */
function finalError(error: unknown, failure: RetryFailure, decision: RetryDecision): unknown {
  const limit = LIMIT_OF[failure.kind];
  if (!limit) return error;
  const resetAt =
    decision.delayMs > 0 && limit !== "billing" ? Date.now() + decision.delayMs : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return new LimitError(message, limit, resetAt, { cause: error });
}

/**
 * One provider request with recovery. A broken stream restarts the answer from scratch, limits
 * wait for the reset the provider reported (the UI shows a countdown), and a context overflow
 * compacts once before the retry. Completed turns stay in history either way.
 */
export async function streamWithRetry(
  messages: Message[],
  options: LoopOptions,
  usage: Usage,
): Promise<StreamedTurn> {
  for (let attempt = 0; ; attempt += 1) {
    let partial = false;
    const emit = (event: LoopEvent): void => {
      if (streamed(event)) partial = true;
      options.emit(event);
    };
    try {
      const turn = await streamAssistant(messages, options, usage, emit);
      options.retryPolicy?.recordSuccess();
      return turn;
    } catch (error) {
      if (!options.retryPolicy || options.signal.aborted || options.stopSignal?.aborted)
        throw error;
      if (options.goal?.isBudgetExhausted()) {
        options.goal.markBlocked("goal budget is exhausted");
        throw error;
      }
      const policy = options.retryPolicy;
      const failure = policy.classify(error);
      const decision = policy.decide(failure, attempt);
      if (!decision.retry) {
        blockGoal(options.goal, `provider retry stopped: ${decision.reason}`);
        throw finalError(error, failure, decision);
      }
      if (!budgetAllowsWait(options.goal, decision.delayMs)) {
        blockGoal(options.goal, "goal budget is exhausted");
        throw finalError(error, failure, decision);
      }
      if (partial) {
        options.emit({ type: "message.reset", reason: decision.reason });
      }
      options.emit({
        type: "provider.retry",
        kind: decision.kind,
        attempt: attempt + 1,
        delayMs: decision.delayMs,
        until: Date.now() + decision.delayMs,
        reason: decision.reason,
      });
      if (decision.compact) {
        await compactContextIfNeeded(messages, { ...options, takeCompactionRequest: () => ({}) });
        await deliverModules(messages, options);
      }
      await sleep(
        decision.delayMs,
        options.stopSignal ? AbortSignal.any([options.signal, options.stopSignal]) : options.signal,
      );
    }
  }
}

export function parseTurnCompletion(
  message: AssistantMessage,
  stopReason: string,
): CompletionSignal | undefined {
  if (message.toolCalls.length > 0 || stopReason === "max_tokens") return undefined;
  return parseCompletionSignal(message.content);
}

export function doneFromToolResult(result: ToolResult): DoneResult | undefined {
  const data = result.data;
  if (!result.terminate || data === null || typeof data !== "object" || !("kind" in data)) {
    return undefined;
  }
  const record = data as { kind?: unknown; summary?: unknown; evidence?: unknown };
  if (record.kind !== "done" || typeof record.summary !== "string") return undefined;
  return {
    summary: record.summary,
    evidence: Array.isArray(record.evidence)
      ? record.evidence.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function markGoalDone(goal: GoalState | undefined, done: DoneResult): void {
  goal?.markMet(done.summary.trim() === "" ? undefined : done.summary);
  for (const item of done.evidence) {
    if (goal && item.trim() !== "" && !goal.evidence.includes(item)) goal.addEvidence(item);
  }
}

export interface GoalProgress {
  evidenceCount: number;
  criteria: string;
}

export function goalProgress(goal: GoalState): GoalProgress {
  return { evidenceCount: goal.evidence.length, criteria: goal.criteria.join("\n") };
}

export function goalProgressed(goal: GoalState, before: GoalProgress, usedTools: boolean): boolean {
  return (
    usedTools ||
    goal.evidence.length > before.evidenceCount ||
    goal.criteria.join("\n") !== before.criteria
  );
}

export class TurnContinuations {
  #lengthAttempts = 0;
  #emptyAttempts = 0;
  #protocolAttempts = 0;
  #sawToolCall = false;
  #noProgressTurns = 0;

  resetForToolUse(): void {
    this.#sawToolCall = true;
    this.#lengthAttempts = 0;
    this.#emptyAttempts = 0;
  }

  takeLength(stopReason: string, limit: number): boolean {
    if (stopReason !== "max_tokens" || this.#lengthAttempts >= limit) return false;
    this.#lengthAttempts += 1;
    return true;
  }

  takeEmpty(visible: boolean, limit: number): boolean {
    if (visible || this.#emptyAttempts >= limit) return false;
    this.#emptyAttempts += 1;
    return true;
  }

  takeProtocol(): boolean {
    if (!this.#sawToolCall || this.#protocolAttempts >= 1) return false;
    this.#protocolAttempts += 1;
    return true;
  }

  noteGoalContinuation(): void {
    this.#noProgressTurns = 0;
  }

  noteGoalProgress(progressed: boolean): boolean {
    this.#noProgressTurns = progressed ? 0 : this.#noProgressTurns + 1;
    return this.#noProgressTurns >= GOAL_NO_PROGRESS_LIMIT;
  }
}

export async function takeSteering(messages: Message[], options: LoopOptions): Promise<boolean> {
  const steered = (await options.takeSteering?.()) ?? [];
  for (const steer of steered) {
    const input = options.language ? await options.language.input(steer.text) : steer.text;
    messages.push({
      role: "user",
      content: input,
      ...(steer.kind !== "notice" && options.allowUserMemory
        ? { memorySource: steer.display ?? steer.text }
        : {}),
      ...(options.language
        ? { workingLanguage: "en" as const, sourceLanguage: options.language.language }
        : {}),
      ...(steer.attachments && steer.attachments.length > 0 ? { images: steer.attachments } : {}),
    });
    if (steer.kind === "notice") {
      const hook = await options.hooks?.run(
        "notification",
        {
          sessionId: options.toolContext.sessionId,
          cwd: options.toolContext.cwd,
          notification: { level: "info", message: steer.text, code: "job_completed" },
        },
        options.signal,
      );
      for (const run of hook?.runs ?? []) options.emit({ type: "hook.finished", hook: run });
      options.emit({ type: "notice.applied", text: input });
      continue;
    }
    // A changed human instruction invalidates the reviewer's original intent context.
    options.dictionary?.observe(steer.display ?? steer.text);
    delete options.userSource;
    options.emit({
      type: "steer.applied",
      text: steer.display ?? steer.text,
      ...(input !== (steer.display ?? steer.text) ? { input } : {}),
      ...(steer.queueId ? { queueId: steer.queueId } : {}),
      ...(steer.attachmentRefs?.length ? { attachments: steer.attachmentRefs } : {}),
    });
  }
  return steered.length > 0;
}
