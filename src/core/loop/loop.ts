import pageCompletionRequired from "../../../prompts/loop/continue-page.md" with { type: "text" };
import { parseCompletionSignal } from "../goal/completion";
import { shouldContinue } from "../goal/state";
import { deliverModules } from "../modules/delivery";
import { PageRuntime } from "../pages/runtime";
import type { Message, ToolResult, Usage } from "../types";
import { compactContextIfNeeded } from "./context";
import { deliverToolMedia } from "./tool-media";
import { toolMessage } from "./tool-message";
import { executeCalls } from "./tools";
import {
  blockGoal,
  CONTINUE_EMPTY,
  CONTINUE_LENGTH,
  CONTINUE_PROTOCOL,
  continueGoalMessage,
  doneFromToolResult,
  goalProgress,
  goalProgressed,
  goalTodosOf,
  markGoalDone,
  parseTurnCompletion,
  streamWithRetry,
  TRUNCATED_CALL,
  TurnContinuations,
  takeSteering,
} from "./turn";
import type { LoopOptions, LoopResult } from "./types";

const PAGE_COMPLETION_REQUIRED = pageCompletionRequired.trim();

function pushSyntheticNotice(messages: Message[], text: string, options: LoopOptions): void {
  messages.push({ role: "user", content: text, synthetic: true });
  options.emit({ type: "notice.applied", text });
}

/** Publish the already checkpointed deliverable without asking the model to reconstruct it. */
function pageResult(
  text: string | undefined,
  messages: Message[],
  options: LoopOptions,
): LoopResult["done"] {
  if (!text) return undefined;
  const remaining = options.goal?.remainingCriteria() ?? [];
  const issue =
    options.completionGuard?.() ??
    (remaining.length ? `Cannot finish while work remains:\n${remaining.join("\n")}` : undefined);
  if (issue) {
    pushSyntheticNotice(messages, issue, options);
    return undefined;
  }
  const done = { summary: text, evidence: [] };
  messages.push({
    role: "assistant",
    content: `<summary>${text}</summary>`,
    reasoning: "",
    toolCalls: [],
  });
  markGoalDone(options.goal, done);
  options.emit({ type: "message.started" });
  options.emit({
    type: "message.finished",
    text,
    reasoning: "",
    toolCalls: [],
    summary: text,
    complete: true,
  });
  return done;
}

export async function runLoop(prompt: string, options: LoopOptions): Promise<LoopResult> {
  const messages: Message[] = options.messages ?? [];
  options = { ...options, tools: options.tools.forSession(messages) };
  messages.push({
    role: "user",
    content: prompt,
    ...(options.syntheticPrompt ? { synthetic: true } : {}),
    ...(options.userSource === undefined ? {} : { memorySource: options.userSource }),
    ...(options.language
      ? { workingLanguage: "en" as const, sourceLanguage: options.language.language }
      : {}),
    ...(options.attachments && options.attachments.length > 0
      ? { images: options.attachments }
      : {}),
  });
  let usage: Usage = { input: 0, output: 0, cached: 0 };
  let turns = 0;
  let lastText = "";
  let done: LoopResult["done"];
  const continuations = new TurnContinuations();
  const goal = options.goal;
  const pages =
    options.role === "worker" && options.tools.get("context")
      ? new PageRuntime(
          messages,
          options.pageWriter?.archive,
          new Set(
            options.tools
              .list()
              .filter((tool) => !tool.mutating)
              .map((tool) => tool.name),
          ),
        )
      : undefined;
  const execution = pages
    ? { ...options, toolContext: { ...options.toolContext, contextPages: pages } }
    : options;

  while (options.maxTurns === 0 || turns < options.maxTurns) {
    if (options.signal.aborted || options.stopSignal?.aborted) {
      return { stopReason: "stopped", summary: lastText, turns, usage, lastText, messages };
    }

    const limit = options.budgetExhausted?.();
    if (limit !== undefined) {
      return { stopReason: "budget", summary: limit, turns, usage, lastText, messages };
    }

    if (goal?.status === "active") {
      if (goal.isBudgetExhausted()) {
        goal.markBlocked("goal budget is exhausted");
        return { stopReason: "end", summary: lastText, turns, usage, lastText, messages };
      }
      goal.start();
    }

    await takeSteering(messages, options);
    const pendingPage = pages?.pending();
    const pendingResult = pages?.finalResult();
    const checkpoint = await compactContextIfNeeded(
      messages,
      pendingPage
        ? { ...options, takeCompactionRequest: () => ({ reason: "page_checkpoint" }) }
        : options,
    );
    if (pages && pendingPage) {
      if (!checkpoint.compacted) {
        throw new Error(`Logical page checkpoint failed: ${checkpoint.reason ?? "no checkpoint"}`);
      }
      pages.checkpointed();
      const completed = pageResult(pendingResult, messages, options);
      if (completed) {
        return {
          stopReason: "done",
          summary: completed.summary,
          turns,
          usage,
          done: completed,
          lastText: completed.summary,
          messages,
        };
      }
    }
    await deliverModules(messages, options);
    if (options.stopSignal?.aborted) {
      return { stopReason: "stopped", summary: lastText, turns, usage, lastText, messages };
    }
    const updatedLimit = options.budgetExhausted?.();
    if (updatedLimit !== undefined) {
      return { stopReason: "budget", summary: updatedLimit, turns, usage, lastText, messages };
    }

    turns += 1;
    options.emit({ type: "turn.started", turn: turns });
    const progressBefore = goal ? goalProgress(goal) : undefined;

    const streamed = await streamWithRetry(messages, options, usage);
    usage = streamed.usage;
    const message = streamed.message;
    const completion =
      options.responseFormat === "structured"
        ? undefined
        : parseTurnCompletion(message, streamed.stopReason);
    const completionIssue = completion?.complete ? options.completionGuard?.() : undefined;
    const acceptedCompletion =
      completion?.complete &&
      !completionIssue &&
      (goal?.remainingCriteria().length ?? 0) === 0 &&
      (!pages || pages.canFinish());
    const display = completionIssue
      ? ""
      : acceptedCompletion && completion
        ? completion.text || completion.summary
        : message.content;
    if (completionIssue) {
      if (options.role === "talker") {
        message.content = completionIssue;
      }
      options.emit({ type: "message.reset", reason: "completion_deferred" });
    }
    if (acceptedCompletion && completion) {
      done = { summary: completion.summary || display, evidence: [] };
      markGoalDone(goal, done);
    }
    messages.push(message);
    const localized = streamed.display && parseCompletionSignal(streamed.display.text);
    options.emit({
      type: "message.finished",
      text: display,
      reasoning: message.reasoning,
      toolCalls: message.toolCalls,
      ...(streamed.display && !completionIssue
        ? {
            display: {
              text:
                acceptedCompletion && localized
                  ? localized.text || localized.summary
                  : streamed.display.text,
              reasoning: streamed.display.reasoning,
              ...(acceptedCompletion && localized ? { summary: localized.summary } : {}),
            },
          }
        : {}),
      ...(message.providerData === undefined ? {} : { providerData: message.providerData }),
      ...(acceptedCompletion && completion ? { summary: completion.summary, complete: true } : {}),
    });

    if (options.signal.aborted) {
      return { stopReason: "stopped", summary: lastText, turns, usage, lastText, messages };
    }

    if (message.toolCalls.length > 0 && streamed.stopReason !== "max_tokens") {
      lastText = message.content;
      continuations.resetForToolUse();

      const results: ToolResult[] = [];
      // ponytail: one mutation mutex for the whole batch; per-path locks if writes become a bottleneck.
      await executeCalls(message.toolCalls, execution, options.emit, results);

      let sawTodoChange = false;
      for (let index = 0; index < message.toolCalls.length; index += 1) {
        const call = message.toolCalls[index];
        const result = results[index];
        if (!call || !result) continue;
        messages.push(toolMessage(call, result));

        const todos = goalTodosOf(result.data);
        if (todos) {
          goal?.applyTodos(todos);
          sawTodoChange = true;
        }

        const toolDone = doneFromToolResult(result);
        if (toolDone) {
          done = toolDone;
          markGoalDone(goal, toolDone);
        }
      }

      await deliverToolMedia(messages, message.toolCalls, results, options);
      const blocked = pages?.blocked();
      const pendingBeforeCheckpoint = pages?.pending();
      if (pendingBeforeCheckpoint && pages) {
        const compacted = await compactContextIfNeeded(messages, {
          ...options,
          takeCompactionRequest: () => ({ reason: "page_checkpoint" }),
        });
        if (!compacted.compacted) {
          throw new Error(`Logical page checkpoint failed: ${compacted.reason ?? "no checkpoint"}`);
        }
        pages.checkpointed();
      }
      const finalResult =
        pendingBeforeCheckpoint || sawTodoChange || results.some((r) => r.ok)
          ? pages?.finalResult()
          : undefined;
      const completed =
        finalResult && (!pages || pages.canFinish())
          ? pageResult(finalResult, messages, options)
          : undefined;
      if (completed) {
        done = completed;
        lastText = completed.summary;
      }
      if (options.stopSignal?.aborted) {
        options.emit({ type: "turn.finished", turn: turns, reason: "stopped" });
        return { stopReason: "stopped", summary: lastText, turns, usage, lastText, messages };
      }

      if (blocked) {
        const report = [
          "# Logical page blocked",
          blocked.summary,
          "## Evidence",
          ...blocked.evidence.map((item) => `- ${item}`),
          "## Next step",
          blocked.next,
        ].join("\n\n");
        blockGoal(goal, blocked.summary);
        options.emit({ type: "turn.finished", turn: turns, reason: "page_blocked" });
        return { stopReason: "end", summary: report, turns, usage, lastText: report, messages };
      }

      if (done) {
        options.emit({ type: "turn.finished", turn: turns, reason: "done" });
        break;
      }

      if (goal && sawTodoChange) {
        const decision = shouldContinue(goal, { text: message.content });
        if (decision.action === "blocked") {
          blockGoal(goal, decision.reason);
          options.emit({ type: "turn.finished", turn: turns, reason: "goal_blocked" });
          return { stopReason: "end", summary: lastText, turns, usage, lastText, messages };
        }
        if (decision.action === "continue") {
          continuations.noteGoalContinuation();
          pushSyntheticNotice(messages, continueGoalMessage(goal), options);
          options.emit({ type: "turn.finished", turn: turns, reason: "continue_goal" });
          continue;
        }
      }

      options.emit({ type: "turn.finished", turn: turns, reason: "tool_use" });
      if (options.signal.aborted) {
        return { stopReason: "stopped", summary: lastText, turns, usage, lastText, messages };
      }
      continue;
    }

    if (message.toolCalls.length > 0 && streamed.stopReason === "max_tokens") {
      const completeCalls = message.toolCalls.slice(0, -1).filter((call) => {
        const prepared = options.tools.prepare(call);
        return !prepared.error && typeof call.args === "object" && call.args !== null;
      });
      if (completeCalls.length === message.toolCalls.length - 1 && completeCalls.length > 0) {
        const results: ToolResult[] = [];
        await executeCalls(completeCalls, execution, options.emit, results);
        completeCalls.forEach((call, i) => {
          if (results[i]) messages.push(toolMessage(call, results[i]));
        });
        const tail = message.toolCalls.at(-1);
        if (tail) {
          const result: ToolResult = { ok: false, output: "", error: TRUNCATED_CALL };
          options.emit({ type: "tool.started", call: tail });
          options.emit({ type: "tool.finished", call: tail, result });
          messages.push(toolMessage(tail, result));
        }
        continuations.resetForToolUse();
        if (options.stopSignal?.aborted) {
          options.emit({ type: "turn.finished", turn: turns, reason: "stopped" });
          return { stopReason: "stopped", summary: lastText, turns, usage, lastText, messages };
        }
        options.emit({ type: "turn.finished", turn: turns, reason: "tool_use" });
        continue;
      }
      for (const call of message.toolCalls) {
        const result: ToolResult = { ok: false, output: "", error: TRUNCATED_CALL };
        options.emit({ type: "tool.started", call });
        options.emit({ type: "tool.finished", call, result });
        messages.push(toolMessage(call, result));
      }
      if (options.stopSignal?.aborted) {
        options.emit({ type: "turn.finished", turn: turns, reason: "stopped" });
        return { stopReason: "stopped", summary: lastText, turns, usage, lastText, messages };
      }
      const retryLen = continuations.takeLength(streamed.stopReason, options.continuations);
      options.emit({
        type: "turn.finished",
        turn: turns,
        reason: retryLen ? "continue_length" : "end",
      });
      if (retryLen) continue;
      return { stopReason: "end", summary: lastText, turns, usage, lastText, messages };
    }

    const visible = display.trim().length > 0;
    const hasOutput = visible || message.reasoning.trim().length > 0;
    if (visible) lastText = display;
    if (completionIssue) {
      if (options.role === "worker" && continuations.takePageIncomplete()) {
        pushSyntheticNotice(messages, completionIssue, options);
        options.emit({ type: "turn.finished", turn: turns, reason: "completion_deferred" });
        continue;
      }
      options.emit({ type: "turn.finished", turn: turns, reason: "completion_deferred" });
      return { stopReason: "end", summary: "", turns, usage, lastText, messages };
    }

    if (options.stopSignal?.aborted) {
      options.emit({ type: "turn.finished", turn: turns, reason: "stopped" });
      return { stopReason: "stopped", summary: lastText, turns, usage, lastText, messages };
    }

    if (continuations.takeLength(streamed.stopReason, options.continuations)) {
      pushSyntheticNotice(messages, CONTINUE_LENGTH, options);
      options.emit({ type: "turn.finished", turn: turns, reason: "continue_length" });
      continue;
    }

    if (
      streamed.stopReason !== "max_tokens" &&
      continuations.takeEmpty(hasOutput, options.continuations)
    ) {
      pushSyntheticNotice(messages, CONTINUE_EMPTY, options);
      options.emit({ type: "turn.finished", turn: turns, reason: "continue_empty" });
      continue;
    }

    if (pages && !pages.canFinish()) {
      if (!continuations.takePageIncomplete()) {
        options.emit({ type: "turn.finished", turn: turns, reason: "end" });
        return { stopReason: "end", summary: lastText, turns, usage, lastText, messages };
      }
      pushSyntheticNotice(messages, PAGE_COMPLETION_REQUIRED, options);
      options.emit({ type: "turn.finished", turn: turns, reason: "page_incomplete" });
      continue;
    }

    if (done) {
      options.emit({ type: "turn.finished", turn: turns, reason: "done" });
      return {
        stopReason: "done",
        summary: done.summary,
        turns,
        usage,
        done,
        lastText,
        messages,
      };
    }

    if (goal && progressBefore) {
      const decision = shouldContinue(goal, { text: message.content });
      if (decision.action === "continue") {
        const progressed = goalProgressed(goal, progressBefore, false);
        if (continuations.noteGoalProgress(progressed)) {
          blockGoal(goal, "goal made no progress across repeated turns");
          options.emit({ type: "turn.finished", turn: turns, reason: "goal_no_progress" });
          return { stopReason: "end", summary: lastText, turns, usage, lastText, messages };
        }
        pushSyntheticNotice(messages, continueGoalMessage(goal), options);
        options.emit({ type: "turn.finished", turn: turns, reason: "continue_goal" });
        continue;
      }
      if (decision.action === "blocked") {
        blockGoal(goal, decision.reason);
        options.emit({ type: "turn.finished", turn: turns, reason: "goal_blocked" });
        return { stopReason: "end", summary: lastText, turns, usage, lastText, messages };
      }
      if (decision.action === "finish" && goal.hasCriteria()) {
        goal.markMet("all acceptance criteria have evidence");
        options.emit({ type: "turn.finished", turn: turns, reason: "goal_met" });
        return {
          stopReason: "done",
          summary: lastText,
          turns,
          usage,
          done: { summary: lastText, evidence: [...goal.evidence] },
          lastText,
          messages,
        };
      }
    }

    if (
      options.responseFormat !== "structured" &&
      options.responseFormat !== "conversation" &&
      continuations.takeProtocol()
    ) {
      pushSyntheticNotice(messages, CONTINUE_PROTOCOL, options);
      options.emit({ type: "turn.finished", turn: turns, reason: "continue_protocol" });
      continue;
    }

    if (
      (options.maxTurns === 0 || turns < options.maxTurns) &&
      (await takeSteering(messages, options))
    ) {
      options.emit({ type: "turn.finished", turn: turns, reason: "steer" });
      continue;
    }

    options.emit({ type: "turn.finished", turn: turns, reason: "end" });
    return {
      stopReason: "end",
      summary: lastText,
      turns,
      usage,
      lastText,
      messages,
    };
  }

  if (goal?.status === "active" && goal.remainingCriteria().length > 0) {
    goal.markBlocked("turn limit reached");
  }

  return {
    stopReason: done ? "done" : "max_turns",
    summary: done?.summary ?? lastText,
    turns,
    usage,
    ...(done ? { done } : {}),
    lastText,
    messages,
  };
}
