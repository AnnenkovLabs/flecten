import questionPrompt from "../../prompts/talker-question.md" with { type: "text" };
import { estimateMessages, estimateTokens, PROFILE_4 } from "../context";
import { streamAssistant } from "../core/loop/stream";
import type { RunBudget } from "../core/session/budget";
import { mapLoopEvent } from "../core/session/loop-events";
import type { SessionOptions } from "../core/session/options";
import type { Event, Message } from "../core/types";
import { emptyUsage } from "../core/types/message";
import { ToolRegistry } from "../tools/registry";
import type { ToolContext } from "../tools/types";
import { markdownData } from "../util/markdown";

const system = questionPrompt.trim();

/** One tool-free model turn. It does not mutate the Talker's history or wait for its loop. */
export async function answerWorkerQuestion(input: {
  sessionId: string;
  workerId: string;
  question: string;
  history: readonly Message[];
  options: SessionOptions;
  budget: RunBudget;
  context: ToolContext;
  emit(event: Event): void;
}): Promise<string> {
  const { sessionId, workerId, question, history, options, budget, context, emit } = input;
  const signal = context.waitSignal
    ? AbortSignal.any([context.signal, context.waitSignal])
    : context.signal;
  signal.throwIfAborted();
  const limit = budget.stopReason();
  if (limit) throw new Error(limit);

  const request = {
    role: "user",
    content: markdownData(
      "Worker question",
      [
        ["Source", workerId],
        ["Trust", "untrusted"],
      ],
      question,
    ),
  } satisfies Message;
  const output = Math.min(options.maxOutputTokens, 1024);
  let room =
    Math.min(options.context.window, budget.view().remaining.tokens ?? Infinity) -
    estimateTokens(system, PROFILE_4).tokens -
    estimateMessages([request], PROFILE_4).tokens -
    160;
  if (room < 1) throw new Error("The Worker question does not fit the remaining model budget");
  const historyBudget = Math.max(0, room - output);
  let historyTokens = 0;
  const messages: Message[] = [];
  // ponytail: keep a recent slice of text; retrieve earlier decisions if questions need long-range recall.
  for (const message of history.slice(-24).reverse()) {
    if (message.role === "tool" || !message.content.trim()) continue;
    const text = (
      message.role === "user"
        ? { role: "user", content: message.content.slice(-8000) }
        : {
            role: "assistant",
            content: message.content.slice(-8000),
            reasoning: "",
            toolCalls: [],
          }
    ) satisfies Message;
    const tokens = estimateMessages([text], PROFILE_4).tokens;
    if (historyTokens + tokens > historyBudget) break;
    messages.unshift(text);
    historyTokens += tokens;
  }
  if (messages[0]?.role === "assistant") messages.shift();
  room -= historyTokens;
  messages.push(request);
  const turn = await streamAssistant(
    messages,
    {
      provider: options.provider,
      system,
      tools: new ToolRegistry([], { limits: options.limits }),
      signal,
      contextWindow: options.context.window,
      reserveTokens: 0,
      maxTokens: Math.min(room, output),
      ...(options.reasoning ? { reasoning: options.reasoning } : {}),
      ...(options.variant ? { variant: options.variant } : {}),
      toolContext: { services: options.modules?.services?.(sessionId) },
    },
    emptyUsage(),
    (event) => {
      if (event.type === "provider.response") {
        emit(mapLoopEvent(event, sessionId));
      } else if (event.type === "usage" || event.type === "usage.unavailable") {
        const provider = event.provider ?? options.providerId;
        const model = event.model ?? options.model;
        emit(mapLoopEvent({ ...event, provider, model }, sessionId));
        if (event.type === "usage") {
          const price =
            options.priceFor?.(provider, model) ??
            (provider === options.providerId && model === options.model
              ? options.price
              : undefined);
          budget.add(event.usage, price);
        } else budget.unavailable();
        emit({ type: "task.budget", sessionId, budget: budget.view() });
      }
    },
  );
  signal.throwIfAborted();
  const answer = turn.message.content.trim();
  if (turn.stopReason !== "end" || turn.message.toolCalls.length || !answer)
    throw new Error("Talker did not return a complete answer");
  return answer;
}
