import type { Message } from "../core/types";
import { isObject, parseToolArgs } from "../util/json";
import {
  apiModel,
  effectiveParallelTools,
  modelConfig,
  promptCacheEnabled,
  requestExtra,
  requestHeaders,
} from "./compat";
import { endpoint, postStream } from "./http";
import { responsesMedia } from "./input-media";
import {
  defaultWarn,
  jsonSchemaFormat,
  strictSchema,
  structuredOutputFormat,
  type Warn,
} from "./schema";
import { parseSse, StreamEvents } from "./sse";
import type { StreamFinishReason } from "./stream-recovery";
import type { ModelEvent, ModelProvider, ModelRequest, ProviderRuntime } from "./types";

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
  emitted: boolean;
}

function responseItems(message: Message): unknown[] | undefined {
  if (message.role !== "assistant" || !isObject(message.providerData)) return undefined;
  if (message.providerData.kind !== "openai-responses") return undefined;
  return Array.isArray(message.providerData.items) ? message.providerData.items : undefined;
}

function convertInput(message: Message): Record<string, unknown>[] {
  if (message.role === "user") {
    return [
      {
        role: "user",
        content: [
          { type: "input_text", text: message.content },
          ...(message.images ?? []).map(responsesMedia),
        ],
      },
    ];
  }
  if (message.role === "assistant") {
    const items = responseItems(message);
    if (items && items.length > 0) return items as Record<string, unknown>[];
    const output: Record<string, unknown>[] = [];
    if (message.content.length > 0) {
      output.push({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: message.content }],
      });
    }
    for (const call of message.toolCalls) {
      output.push({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.args ?? {}),
      });
    }
    return output;
  }
  return [{ type: "function_call_output", call_id: message.toolCallId, output: message.content }];
}

function buildBody(
  request: ModelRequest,
  runtime: ProviderRuntime,
  warn: Warn,
): Record<string, unknown> {
  const model = modelConfig(runtime, request.model);
  const reasoning =
    request.reasoning !== undefined || model?.reasoning
      ? {
          reasoning: {
            ...(request.reasoning === undefined ? {} : { effort: request.reasoning }),
            summary: "auto",
          },
        }
      : {};
  const parallel = effectiveParallelTools(runtime, model);
  const cacheEnabled = promptCacheEnabled(runtime, model);
  const strictTools = model?.compat?.strictTools ?? runtime.config.strictTools;
  const format = structuredOutputFormat(model);
  const text = format
    ? {
        text: {
          format: { type: "json_schema", name: format.name, ...jsonSchemaFormat(format, warn) },
        },
      }
    : {};
  const body: Record<string, unknown> = {
    model: apiModel(request),
    instructions: request.system,
    input: request.messages.flatMap(convertInput),
    tools:
      request.tools.length > 0
        ? request.tools.map((tool) => {
            let parameters = tool.parameters;
            let strict = false;
            if (strictTools) {
              const transformed = strictSchema(parameters);
              parameters = transformed.schema;
              strict = transformed.strict;
              if (!strict) {
                warn(`strict tools disabled for "${tool.name}": ${transformed.reason}`);
              }
            }
            return {
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters,
              ...(strict ? { strict: true } : {}),
            };
          })
        : undefined,
    stream: true,
    store: false,
    include: ["reasoning.encrypted_content"],
    max_output_tokens: request.maxTokens,
    ...text,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...reasoning,
    ...(parallel === undefined ? {} : { parallel_tool_calls: parallel }),
    ...(cacheEnabled && runtime.config.promptCacheKey
      ? { prompt_cache_key: runtime.config.promptCacheKey }
      : {}),
    ...(request.toolChoice === "required" ||
    request.toolChoice === "none" ||
    request.toolChoice === "auto"
      ? { tool_choice: request.toolChoice }
      : {}),
    ...requestExtra(runtime, model, request),
  };
  body.stream = true;
  return body;
}

function readUsage(value: unknown): ModelEvent | undefined {
  if (!isObject(value)) return undefined;
  const usage = value as ResponsesUsage;
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
      if (runtime.apiKey && !headers.authorization) {
        headers.authorization = `Bearer ${runtime.apiKey}`;
      }

      const response = await postStream({
        url: endpoint(runtime.baseUrl, "/responses"),
        headers,
        body: buildBody(request, runtime, warn),
        signal,
        providerId: runtime.providerId,
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

          const type = typeof event.type === "string" ? event.type : "";
          if (type === "error") {
            const error = isObject(event.error) ? event.error : event;
            events.fail(
              "server",
              typeof error.message === "string" ? error.message : "provider stream error",
            );
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
              const name = typeof item.name === "string" ? item.name : "";
              const initial = typeof item.arguments === "string" ? item.arguments : "";
              calls.set(itemId, {
                itemId,
                callId,
                index,
                name,
                arguments: initial,
                emitted: false,
              });
              if (name) yield events.emit({ type: "tool_call_progress", index, name });
              if (initial) yield events.emit({ type: "tool_call_progress", index, delta: initial });
            }
            continue;
          }

          if (type === "response.function_call_arguments.delta") {
            const itemId = typeof event.item_id === "string" ? event.item_id : "";
            const call = calls.get(itemId);
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
            const call = calls.get(itemId);
            if (call) {
              if (typeof event.arguments === "string") call.arguments = event.arguments;
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
              const call = calls.get(itemId);
              if (call) {
                if (typeof item.arguments === "string") call.arguments = item.arguments;
                const toolEvent = emitCall(call);
                if (toolEvent) yield events.emit(toolEvent);
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
            continue;
          }

          if (type === "response.completed" || type === "response.incomplete") {
            terminal = isObject(event.response) ? event.response : {};
            sawTerminal = true;
            break;
          }

          if (type === "response.failed") {
            const failure = isObject(event.response) ? event.response : event;
            const error = isObject(failure.error) ? failure.error : {};
            events.fail(
              "server",
              typeof error.message === "string" ? error.message : "response failed",
            );
          }
        }
      } catch (error) {
        if (signal.aborted) throw error;
        events.interrupted(error, "response.completed");
      }

      if (!sawTerminal) events.requireDone("response.completed or response.incomplete");

      for (const call of calls.values()) {
        const toolEvent = emitCall(call);
        if (toolEvent) yield events.emit(toolEvent);
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
      yield events.done(readReason(terminal, calls.size > 0));
    },
  };
}
