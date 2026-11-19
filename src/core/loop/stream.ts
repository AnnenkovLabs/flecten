import { estimateMessages, PROFILE_4 } from "../../context";
import { responseOfError } from "../../providers/response";
import { TranslationStream } from "../../translation/stream";
import { serviceModelStream } from "../services/model";
import type { AssistantMessage, Message, ToolCall, Usage } from "../types";
import { addUsage } from "../types/message";
import { contextEstimate, recordProviderContextTokens } from "./context";
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
  options: Pick<
    LoopOptions,
    | "contextWindow"
    | "dictionary"
    | "language"
    | "maxTokens"
    | "memory"
    | "provider"
    | "reasoning"
    | "reserveTokens"
    | "signal"
    | "system"
    | "tools"
    | "variant"
    | "workingSetTokens"
  > & {
    parallelTools?: boolean | undefined;
    toolContext: Pick<LoopOptions["toolContext"], "inspectImage" | "services"> & {
      sessionId?: string | undefined;
    };
  },
  usage: Usage,
  emit: (event: LoopEvent) => void,
): Promise<StreamedTurn> {
  const effectiveCeiling = Math.min(
    options.contextWindow - options.reserveTokens,
    options.workingSetTokens ?? options.contextWindow - options.reserveTokens,
  );
  const availableRoom = Math.max(
    0,
    effectiveCeiling - contextEstimate(options.system, messages, options.tools) - 160,
  );
  const dictionary = await options.dictionary?.delivery(availableRoom);
  const dictionaryTokens = dictionary ? estimateMessages([dictionary], PROFILE_4).tokens : 0;
  const memoryRoom = options.memory
    ? Math.max(
        0,
        Math.min(
          1200,
          effectiveCeiling -
            contextEstimate(options.system, messages, options.tools) -
            dictionaryTokens -
            160,
        ),
      )
    : 0;
  const delivery = await options.memory?.refresh(memoryRoom);
  if (delivery) {
    messages.push({
      role: "user",
      content: delivery.text,
      synthetic: true,
      memoryReferences: delivery.references,
    });
    emit({ type: "memory.context", ...delivery });
  }
  const requestMessages =
    dictionary && messages.length > 0
      ? [...messages, dictionary]
      : dictionary
        ? [dictionary]
        : messages;
  if (dictionary)
    emit({
      type: "context.usage",
      used: contextEstimate(options.system, requestMessages, options.tools),
      window: options.contextWindow,
      reserve: options.reserveTokens,
      source: "estimate",
    });
  const modelMessages = await visionMessages(
    requestMessages,
    options.toolContext.inspectImage,
    options.signal,
  );
  const sessionId = options.toolContext.sessionId;
  const request = {
    model: options.provider.model,
    system: options.system,
    messages: modelMessages,
    tools: options.tools.specs(),
    maxTokens: Math.max(
      1,
      Math.min(
        options.maxTokens,
        options.contextWindow - contextEstimate(options.system, modelMessages, options.tools),
      ),
    ),
    ...(options.reasoning ? { reasoning: options.reasoning } : {}),
    ...(options.variant ? { variant: options.variant } : {}),
    ...(options.parallelTools === undefined ? {} : { parallelToolCalls: options.parallelTools }),
    ...(sessionId ? { promptCacheKey: `flecten:${sessionId}` } : {}),
  };

  let text = "";
  let reasoning = "";
  let providerData: unknown;
  const toolCalls: ToolCall[] = [];
  let stopReason = "end";
  let responseReported = false;
  const receipts = new Set<string>();
  let currentUsage = usage;
  let route: { provider?: string; model: string } = { model: options.provider.model };
  let requestTokens = 0;
  let usageReported = false;
  let missingReported = false;
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
  const recordResponse = (response: import("../../providers/response").ProviderResponse): void => {
    const key = response.attemptId ?? response.requestId ?? "unidentified";
    if (receipts.has(key)) return;
    receipts.add(key);
    responseReported = true;
    emit({ type: "provider.response", response });
    if (response.usage === "missing" && response.requested !== false) {
      const provider = response.provider ?? route.provider;
      emit({
        type: "usage.unavailable",
        ...(provider ? { provider } : {}),
        model: response.model ?? route.model,
      });
      missingReported = true;
    }
  };

  try {
    for await (const event of serviceModelStream(
      options.provider,
      request,
      guard.signal,
      options.toolContext.services,
    )) {
      if (event.type === "response") {
        recordResponse(event.response);
      } else if (event.type === "text") {
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
        usageReported = true;
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
          ...(event.provider
            ? { provider: event.provider }
            : route.provider
              ? { provider: route.provider }
              : {}),
          model: event.model ?? route.model,
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
        if (event.response) recordResponse(event.response);
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
  } catch (error) {
    const response = responseOfError(error);
    if (response && !responseReported) recordResponse(response);
    throw error;
  } finally {
    if (!usageReported && !missingReported && !responseReported)
      emit({ type: "usage.unavailable", ...route });
    await presentation?.cancel();
    guard.done();
  }
  if (requestTokens > 0) {
    recordProviderContextTokens(
      messages,
      Math.max(0, requestTokens - dictionaryTokens),
      messages.length + 1,
    );
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
