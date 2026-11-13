import { estimateMessages, PROFILE_4 } from "../../context";
import { TranslationStream } from "../../translation/stream";
import { serviceModelStream } from "../services/model";
import type { AssistantMessage, Message, ToolCall, Usage } from "../types";
import { addUsage } from "../types/message";
import { contextEstimate } from "./context";
import type { LoopEvent, LoopOptions } from "./types";

import { visionMessages } from "./vision";

const REQUEST_TIMEOUT_MS = 10 * 60_000;

function startRequestTimeout(signal: AbortSignal): {
  signal: AbortSignal;
  done: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("provider request timed out")),
    REQUEST_TIMEOUT_MS,
  );
  const combined = AbortSignal.any([signal, controller.signal]);
  return {
    signal: combined,
    done: () => clearTimeout(timer),
  };
}

export interface StreamedTurn {
  message: AssistantMessage;
  usage: Usage;
  stopReason: string;
  display?: { text: string; reasoning: string };
}

export async function streamAssistant(
  messages: Message[],
  options: LoopOptions,
  usage: Usage,
  emit: (event: LoopEvent) => void,
): Promise<StreamedTurn> {
  const availableRoom = Math.max(
    0,
    options.contextWindow -
      options.reserveTokens -
      contextEstimate(options.system, messages, options.tools) -
      160,
  );
  const dictionary = await options.dictionary?.delivery(availableRoom);
  const dictionaryTokens = dictionary ? estimateMessages([dictionary], PROFILE_4).tokens : 0;
  const memoryRoom = options.memory
    ? Math.max(
        0,
        Math.min(
          1200,
          options.contextWindow -
            options.reserveTokens -
            contextEstimate(options.system, messages, options.tools) -
            dictionaryTokens -
            160,
        ),
      )
    : 0;
  const delivery = await options.memory?.refresh(memoryRoom);
  if (delivery) {
    messages.push({ role: "user", content: delivery.text, memoryReferences: delivery.references });
    emit({ type: "memory.context", ...delivery });
  }
  const requestMessages = dictionary ? [...messages, dictionary] : messages;
  if (dictionary)
    emit({
      type: "context.usage",
      used: contextEstimate(options.system, requestMessages, options.tools),
      window: options.contextWindow,
      reserve: options.reserveTokens,
      source: "estimate",
    });
  const request = {
    model: options.provider.model,
    system: options.system,
    messages: await visionMessages(
      requestMessages,
      options.toolContext.inspectImage,
      options.signal,
    ),
    tools: options.tools.specs(),
    maxTokens: options.maxTokens,
    ...(options.reasoning ? { reasoning: options.reasoning } : {}),
    ...(options.variant ? { variant: options.variant } : {}),
  };

  let text = "";
  let reasoning = "";
  let providerData: unknown;
  const toolCalls: ToolCall[] = [];
  let stopReason = "end";
  let currentUsage = usage;
  let route: { provider?: string; model: string } = { model: options.provider.model };
  let requestTokens = 0;
  let textStarted = false;
  const emitText = (text: string): void => {
    if (text.length === 0) return;
    if (!textStarted) {
      textStarted = true;
      emit({ type: "message.started" });
    }
    emit({ type: "message.delta", text });
  };
  const guard = startRequestTimeout(options.signal);
  const presentation =
    options.language && new Intl.Locale(options.language.language).language !== "en"
      ? new TranslationStream(options.language, (kind, text) => {
          if (kind === "text") emitText(text);
          else emit({ type: "reasoning.delta", text });
        })
      : undefined;
  let display: StreamedTurn["display"];

  try {
    for await (const event of serviceModelStream(
      options.provider,
      request,
      guard.signal,
      options.toolContext.services,
    )) {
      if (event.type === "text") {
        text += event.delta;
        if (presentation) presentation.push("text", event.delta);
        else emitText(event.delta);
      } else if (event.type === "reasoning") {
        reasoning += event.delta;
        if (presentation) presentation.push("reasoning", event.delta);
        else emit({ type: "reasoning.delta", text: event.delta });
      } else if (event.type === "tool_call") {
        toolCalls.push({
          id: event.id,
          name: event.name,
          args: event.args,
          ...(event.extraContent === undefined ? {} : { extraContent: event.extraContent }),
        });
      } else if (event.type === "provider_data") {
        providerData = event.data;
      } else if (event.type === "tool_call_progress") {
        emit({
          type: "tool_call.progress",
          index: event.index,
          ...(event.name ? { name: event.name } : {}),
          ...(event.delta ? { delta: event.delta } : {}),
        });
      } else if (event.type === "usage") {
        requestTokens += event.input + event.output;
        currentUsage = addUsage(currentUsage, {
          input: event.input,
          output: event.output,
          cached: event.cached,
          ...(event.reasoning === undefined ? {} : { reasoning: event.reasoning }),
          ...(event.cacheWrite === undefined ? {} : { cacheWrite: event.cacheWrite }),
        });
        emit({
          type: "usage",
          ...route,
          usage: {
            input: event.input,
            output: event.output,
            cached: event.cached,
            ...(event.reasoning === undefined ? {} : { reasoning: event.reasoning }),
            ...(event.cacheWrite === undefined ? {} : { cacheWrite: event.cacheWrite }),
          },
        });
      } else if (event.type === "route") {
        route = { provider: event.provider, model: event.model };
        emit({
          type: "model.fallback",
          provider: event.provider,
          model: event.model,
          reason: event.reason,
        });
      } else if (event.type === "done") {
        stopReason = event.reason;
      }
    }
    try {
      display = await presentation?.finish();
    } catch {
      options.signal.throwIfAborted();
      emit({ type: "message.reset", reason: "translation_failed" });
      emit({ type: "reasoning.delta", text: reasoning });
      emitText(text);
      display = { text, reasoning };
    }
  } finally {
    await presentation?.cancel();
    guard.done();
  }
  if (requestTokens > 0) {
    // The provider count of this request plus its answer is what the next request starts from.
    emit({
      type: "context.usage",
      used: requestTokens,
      window: options.contextWindow,
      reserve: options.reserveTokens,
      source: "provider",
    });
  }

  return {
    message: {
      role: "assistant",
      ...(options.language ? { workingLanguage: "en" as const } : {}),
      content: text,
      reasoning,
      toolCalls,
      ...(providerData === undefined ? {} : { providerData }),
    },
    usage: currentUsage,
    stopReason,
    ...(display ? { display } : {}),
  };
}
