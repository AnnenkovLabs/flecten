import { isObject, parseToolArgs } from "../util/json";
import {
  apiModel,
  hasHeader,
  modelConfig,
  promptCacheEnabled,
  requestHeaders,
  supportsPromptCacheKey,
} from "./compat";
import { endpoint, postStream } from "./http";
import { buildResponsesBody } from "./openai-responses-body";
import { defaultWarn, type Warn } from "./schema";
import { classifyStreamError, parseSse, StreamEvents } from "./sse";
import type { StreamFinishReason } from "./stream-recovery";
import type { ModelEvent, ModelProvider, ProviderRuntime } from "./types";

interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

interface StreamCall {
  itemId: string;
  callId: string;
  index: number;
  name: string;
  arguments: string;
  done: boolean;
  emitted: boolean;
}

function readUsage(value: unknown): ModelEvent | undefined {
  if (!isObject(value)) return undefined;
  const usage = value as ResponsesUsage;
  if (typeof usage.input_tokens !== "number" && typeof usage.output_tokens !== "number") {
    return undefined;
  }
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  return {
    type: "usage",
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cached: usage.input_tokens_details?.cached_tokens ?? 0,
    ...(typeof reasoning === "number" ? { reasoning } : {}),
  };
}

function readReason(response: unknown, hasCalls: boolean): StreamFinishReason {
  if (isObject(response) && isObject(response.incomplete_details)) {
    const reason = response.incomplete_details.reason;
    if (reason === "max_output_tokens") return "max_tokens";
    if (reason === "content_filter") return "content_filter";
  }
  if (hasCalls) return "tool_use";
  return "end";
}

function itemText(item: unknown): string {
  if (!isObject(item) || !Array.isArray(item.content)) return "";
  return item.content
    .map((part) => {
      if (!isObject(part)) return "";
      const text = typeof part.text === "string" ? part.text : "";
      return text;
    })
    .join("");
}

function itemReasoning(item: unknown): string {
  if (!isObject(item)) return "";
  const summary = Array.isArray(item.summary)
    ? item.summary
        .map((part) => (isObject(part) && typeof part.text === "string" ? part.text : ""))
        .join("")
    : "";
  if (summary.length > 0) return summary;
  return itemText(item);
}

export function createOpenAiResponses(
  runtime: ProviderRuntime,
  warn: Warn = defaultWarn,
): ModelProvider {
  return {
    id: "openai-responses",
    model: "",
    async *stream(request, signal): AsyncGenerator<ModelEvent> {
      const model = modelConfig(runtime, request.model);
      const headers = requestHeaders(runtime, model, request);
      if (runtime.apiKey && !hasHeader(headers, "authorization")) {
        headers.authorization = `Bearer ${runtime.apiKey}`;
      }
      const cacheKey = request.promptCacheKey || runtime.config.promptCacheKey;
      if (
        promptCacheEnabled(runtime, model) &&
        supportsPromptCacheKey(runtime, model) &&
        cacheKey
      ) {
        headers.session_id ??= cacheKey;
        headers.conversation_id ??= cacheKey;
      }

      const response = await postStream({
        url: endpoint(runtime.baseUrl, "/responses"),
        headers,
        body: buildResponsesBody(request, runtime, warn),
        signal,
        providerId: runtime.providerId,
        model: apiModel(request),
        ...(model?.quotaGroup ? { quotaGroup: model.quotaGroup } : {}),
        ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
        ...(runtime.config.transport?.retries === undefined
          ? {}
          : { retries: runtime.config.transport.retries }),
      });
      if (!response.body) throw new Error("provider returned an empty body");

      const events = new StreamEvents();
      const calls = new Map<string, StreamCall>();
      const outputItems: unknown[] = [];
      let usage: ModelEvent | undefined;
      let terminal: Record<string, unknown> | undefined;
      let sawTerminal = false;
      let sawText = false;
      let sawReasoning = false;

      const emitCall = (call: StreamCall): ModelEvent | undefined => {
        if (call.emitted || !call.name) return undefined;
        call.emitted = true;
        return {
          type: "tool_call",
          id: call.callId,
          name: call.name,
          args: call.arguments.trim().length > 0 ? parseToolArgs(call.arguments) : {},
        };
      };

      try {
        for await (const message of parseSse(response.body, signal)) {
          let event: Record<string, unknown>;
          try {
            const parsed = JSON.parse(message.data) as unknown;
            if (!isObject(parsed)) continue;
            event = parsed;
          } catch {
            continue;
          }

          const type = typeof event.type === "string" ? event.type : message.event;
          if (type === "error" || (type === "" && isObject(event.error))) {
            const classified = classifyStreamError(event, "provider stream error");
            events.fail(classified.kind, classified.message);
          }

          if (type === "response.output_text.delta" && typeof event.delta === "string") {
            sawText = true;
            yield events.emit({ type: "text", delta: event.delta });
            continue;
          }

          if (
            (type === "response.reasoning_summary_text.delta" ||
              type === "response.reasoning_text.delta") &&
            typeof event.delta === "string"
          ) {
            sawReasoning = true;
            yield events.emit({ type: "reasoning", delta: event.delta });
            continue;
          }

          if (type === "response.output_item.added" && isObject(event.item)) {
            const item = event.item;
            if (item.type === "function_call") {
              const itemId = typeof item.id === "string" ? item.id : "";
              const callId = typeof item.call_id === "string" ? item.call_id : itemId;
              const index =
                typeof event.output_index === "number" ? event.output_index : calls.size;
              const key = itemId || callId || `idx_${index}`;
              const name = typeof item.name === "string" ? item.name : "";
              const initial = typeof item.arguments === "string" ? item.arguments : "";
              calls.set(key, {
                itemId,
                callId: callId || key,
                index,
                name,
                arguments: initial,
                done: false,
                emitted: false,
              });
              if (name) yield events.emit({ type: "tool_call_progress", index, name });
              if (initial) yield events.emit({ type: "tool_call_progress", index, delta: initial });
            }
            continue;
          }

          if (type === "response.function_call_arguments.delta") {
            const itemId = typeof event.item_id === "string" ? event.item_id : "";
            const call =
              calls.get(itemId) ??
              (typeof event.output_index === "number"
                ? calls.get(`idx_${event.output_index}`)
                : undefined);
            if (call && typeof event.delta === "string") {
              call.arguments += event.delta;
              yield events.emit({
                type: "tool_call_progress",
                index: call.index,
                delta: event.delta,
              });
            }
            continue;
          }

          if (type === "response.function_call_arguments.done") {
            const itemId = typeof event.item_id === "string" ? event.item_id : "";
            const call =
              calls.get(itemId) ??
              (typeof event.output_index === "number"
                ? calls.get(`idx_${event.output_index}`)
                : undefined);
            if (call) {
              if (typeof event.arguments === "string") call.arguments = event.arguments;
              call.done = true;
              const toolEvent = emitCall(call);
              if (toolEvent) yield events.emit(toolEvent);
            }
            continue;
          }

          if (type === "response.output_item.done" && isObject(event.item)) {
            const item = event.item;
            outputItems.push(item);
            if (item.type === "function_call") {
              const itemId = typeof item.id === "string" ? item.id : "";
              const callId = typeof item.call_id === "string" ? item.call_id : itemId;
              const index =
                typeof event.output_index === "number" ? event.output_index : calls.size;
              const key = itemId || callId || `idx_${index}`;
              let call =
                calls.get(key) ??
                (callId ? calls.get(callId) : undefined) ??
                calls.get(`idx_${index}`);
              if (!call) {
                call = {
                  itemId,
                  callId: callId || key,
                  index,
                  name: typeof item.name === "string" ? item.name : "",
                  arguments: typeof item.arguments === "string" ? item.arguments : "",
                  done: true,
                  emitted: false,
                };
                calls.set(key, call);
              } else {
                if (typeof item.arguments === "string") call.arguments = item.arguments;
                if (typeof item.name === "string" && !call.name) call.name = item.name;
                if (callId && !call.callId) call.callId = callId;
                call.done = true;
              }
              const toolEvent = emitCall(call);
              if (toolEvent) yield events.emit(toolEvent);
            } else if (item.type === "message" && !sawText) {
              const text = itemText(item);
              if (text.length > 0) {
                sawText = true;
                yield events.emit({ type: "text", delta: text });
              }
            } else if (item.type === "reasoning" && !sawReasoning) {
              const text = itemReasoning(item);
              if (text.length > 0) {
                sawReasoning = true;
                yield events.emit({ type: "reasoning", delta: text });
              }
            }
            continue;
          }

          if (type === "response.completed" || type === "response.incomplete") {
            terminal = isObject(event.response) ? event.response : {};
            sawTerminal = true;
            break;
          }

          if (type === "response.failed") {
            const failure = isObject(event.response) ? event.response : event;
            const nextUsage = readUsage(failure.usage);
            if (nextUsage) usage = nextUsage;
            const classified = classifyStreamError(failure, "response failed");
            events.fail(classified.kind, classified.message);
          }
        }
      } catch (error) {
        if (usage) yield events.emit(usage);
        if (signal.aborted) throw error;
        events.interrupted(error, "response.completed");
      }

      if (!sawTerminal) {
        if (usage) yield events.emit(usage);
        events.requireDone("response.completed or response.incomplete");
      }

      if (Array.isArray(terminal?.output)) {
        for (const item of terminal.output) {
          if (!isObject(item)) continue;
          if (item.type === "function_call") {
            const itemId = typeof item.id === "string" ? item.id : "";
            const callId = typeof item.call_id === "string" ? item.call_id : itemId;
            const key = itemId || callId || `idx_${calls.size}`;
            if (
              !calls.has(key) &&
              !(callId && [...calls.values()].some((c) => c.callId === callId))
            ) {
              calls.set(key, {
                itemId,
                callId: callId || key,
                index: calls.size,
                name: typeof item.name === "string" ? item.name : "",
                arguments: typeof item.arguments === "string" ? item.arguments : "",
                done: true,
                emitted: false,
              });
            }
          } else if (item.type === "message" && !sawText) {
            const text = itemText(item);
            if (text.length > 0) {
              sawText = true;
              yield events.emit({ type: "text", delta: text });
            }
          } else if (item.type === "reasoning" && !sawReasoning) {
            const text = itemReasoning(item);
            if (text.length > 0) {
              sawReasoning = true;
              yield events.emit({ type: "reasoning", delta: text });
            }
          }
        }
      }

      const provisionalReason = readReason(terminal, calls.size > 0);
      for (const call of calls.values()) {
        if (provisionalReason === "max_tokens" && !call.done) continue;
        const toolEvent = emitCall(call);
        if (toolEvent) yield events.emit(toolEvent);
      }
      const emittedCalls = [...calls.values()].filter((call) => call.emitted);
      if (outputItems.length > 0) {
        const recordedIds = new Set(
          outputItems.flatMap((item) =>
            isObject(item) && item.type === "function_call" && typeof item.call_id === "string"
              ? [item.call_id]
              : [],
          ),
        );
        for (const call of emittedCalls) {
          if (recordedIds.has(call.callId)) continue;
          outputItems.push({
            type: "function_call",
            ...(call.itemId ? { id: call.itemId } : {}),
            call_id: call.callId,
            name: call.name,
            arguments: call.arguments.trim().length > 0 ? call.arguments : "{}",
          });
        }
      }
      const nextUsage = readUsage(terminal?.usage);
      if (nextUsage) usage = nextUsage;
      if (outputItems.length > 0) {
        yield events.emit({
          type: "provider_data",
          data: { kind: "openai-responses", items: outputItems },
        });
      }
      if (usage) yield events.emit(usage);
      yield events.done(readReason(terminal, emittedCalls.length > 0));
    },
  };
}
