import type { ModelConfig } from "../config/schema";
import type { Message, ToolCall } from "../core/types";
import { isObject, parseToolArgs } from "../util/json";
import {
  apiModel,
  effectiveParallelTools,
  effortField,
  emptyReasoningValue,
  isOpenRouter,
  modelConfig,
  normalizeEffort,
  openAiThinking,
  promptCacheEnabled,
  replayMode,
  requestExtra,
  requestHeaders,
} from "./compat";
import { endpoint, postStream } from "./http";
import { chatMedia } from "./input-media";
import { usesCompletionTokens } from "./model-family";
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

interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
  prompt_tokens_details?: { cached_tokens?: number };
  prompt_cache_hit_tokens?: number;
}

interface ChatDelta {
  content?: string | Array<{ type?: string; text?: string }>;
  reasoning_content?: string;
  reasoning?: string;
  reasoning_text?: string;
  reasoning_details?: unknown[];
  tool_calls?: Array<{
    index?: number;
    id?: string;
    extra_content?: unknown;
    function?: { name?: string; arguments?: string };
  }>;
}

interface ChatChunk {
  choices?: Array<{
    delta?: ChatDelta;
    finish_reason?: string | null;
  }>;
  usage?: ChatUsage;
  error?: { message?: string };
}

interface StreamToolCall {
  id: string;
  name: string;
  arguments: string;
  extraContent?: unknown;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function mergeReasoningDetails(target: unknown[], incoming: unknown[]): void {
  for (const part of incoming) {
    if (!isObject(part)) {
      target.push(part);
      continue;
    }
    const index = typeof part.index === "number" ? part.index : target.length;
    const existing = target[index];
    if (!isObject(existing)) {
      target[index] = { ...part };
      continue;
    }
    const merged: Record<string, unknown> = { ...existing, ...part };
    for (const key of ["text", "summary"]) {
      const previous = typeof existing[key] === "string" ? existing[key] : "";
      const next = typeof part[key] === "string" ? part[key] : "";
      if (previous || next) merged[key] = previous + next;
    }
    target[index] = merged;
  }
}

function reasoningText(details: unknown[]): string {
  return details
    .map((part) => {
      if (!isObject(part)) return "";
      const text = typeof part.text === "string" ? part.text : "";
      const summary = typeof part.summary === "string" ? part.summary : "";
      return text || summary;
    })
    .join("");
}

function openRouterDetails(message: Message): unknown[] | undefined {
  if (message.role !== "assistant" || !isObject(message.providerData)) return undefined;
  if (message.providerData.kind !== "openrouter") return undefined;
  return Array.isArray(message.providerData.details) ? message.providerData.details : undefined;
}

function convertMessage(
  message: Message,
  runtime: ProviderRuntime,
  request: ModelRequest,
): Record<string, unknown> {
  const model = modelConfig(runtime, request.model);
  if (message.role === "user") {
    if (!message.images || message.images.length === 0) {
      return { role: "user", content: message.content };
    }
    return {
      role: "user",
      content: [{ type: "text", text: message.content }, ...message.images.map(chatMedia)],
    };
  }
  if (message.role === "assistant") {
    const replay = replayMode(runtime, model);
    const details =
      isOpenRouter(runtime) &&
      (model?.compat?.reasoningDetails ?? runtime.config.reasoningDetails) !== "never"
        ? openRouterDetails(message)
        : undefined;
    const empty = request.tools.length > 0 ? emptyReasoningValue(runtime) : undefined;
    const reasoning = message.reasoning.length > 0 ? message.reasoning : empty;
    const field = replay === "alias" ? "reasoning" : "reasoning_content";
    const hasDetails = details !== undefined && details.length > 0;
    return {
      role: "assistant",
      content: message.content.length > 0 ? message.content : null,
      ...(replay !== "never" && reasoning !== undefined && !hasDetails
        ? { [field]: reasoning }
        : {}),
      ...(hasDetails ? { reasoning_details: details } : {}),
      tool_calls:
        message.toolCalls.length > 0
          ? message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              ...(call.extraContent === undefined ? {} : { extra_content: call.extraContent }),
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args ?? {}),
              },
            }))
          : undefined,
    };
  }
  return {
    role: "tool",
    tool_call_id: message.toolCallId,
    content: message.content,
  };
}

function mapFinish(reason: string | null | undefined, hasToolCalls: boolean): StreamFinishReason {
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "content_filter";
  if (hasToolCalls || reason === "tool_calls" || reason === "function_call") return "tool_use";
  return "end";
}

function parseUsage(usage: ChatUsage | undefined): ModelEvent | undefined {
  if (!usage) return undefined;
  const reasoning =
    usage.completion_tokens_details?.reasoning_tokens ??
    usage.output_tokens_details?.reasoning_tokens;
  return {
    type: "usage",
    input: usage.prompt_tokens ?? 0,
    output: usage.completion_tokens ?? 0,
    cached: usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0,
    ...(typeof reasoning === "number" ? { reasoning } : {}),
  };
}

function maxTokensField(
  model: ModelConfig | undefined,
  modelId: string,
  maxTokens: number,
): Record<string, number> {
  if (model?.maxTokensParameter === "max_tokens") return { max_tokens: maxTokens };
  if (model?.maxTokensParameter === "max_completion_tokens") {
    return { max_completion_tokens: maxTokens };
  }
  if (usesCompletionTokens(modelId)) return { max_completion_tokens: maxTokens };
  return { max_tokens: maxTokens };
}

function buildBody(
  request: ModelRequest,
  runtime: ProviderRuntime,
  warn: Warn,
): Record<string, unknown> {
  const model = modelConfig(runtime, request.model);
  const effort = request.reasoning;
  const thinking = openAiThinking(runtime, effort, model);
  const effortPayload = effortField(runtime, request.model, model, effort);
  const openRouterEffort =
    isOpenRouter(runtime) && effort && effort !== "none" && model?.reasoning !== false
      ? { reasoning: { effort: normalizeEffort(effort, model) } }
      : {};

  const strictTools = model?.compat?.strictTools ?? runtime.config.strictTools;
  const tools =
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
            function: {
              name: tool.name,
              description: tool.description,
              parameters,
              ...(strict ? { strict: true } : {}),
            },
          };
        })
      : undefined;
  const format = structuredOutputFormat(model);
  const responseFormat = format
    ? { type: "json_schema", json_schema: { name: format.name, ...jsonSchemaFormat(format, warn) } }
    : undefined;
  const parallel = effectiveParallelTools(runtime, model);
  const cacheEnabled = promptCacheEnabled(runtime, model);
  const streamUsage = model?.compat?.streamUsage ?? runtime.config.streamUsage;
  const body: Record<string, unknown> = {
    model: apiModel(request),
    messages: [
      { role: "system", content: request.system },
      ...request.messages.map((message) => convertMessage(message, runtime, request)),
    ],
    tools,
    ...(streamUsage ? { stream_options: { include_usage: true } } : {}),
    ...maxTokensField(model, apiModel(request), request.maxTokens),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...thinking,
    ...(isOpenRouter(runtime) ? openRouterEffort : effortPayload),
    ...(parallel === undefined ? {} : { parallel_tool_calls: parallel }),
    ...(cacheEnabled && runtime.config.promptCacheKey
      ? isOpenRouter(runtime)
        ? { session_id: runtime.config.promptCacheKey }
        : { prompt_cache_key: runtime.config.promptCacheKey }
      : {}),
    ...(request.toolChoice === "required" ||
    request.toolChoice === "none" ||
    request.toolChoice === "auto"
      ? { tool_choice: request.toolChoice }
      : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...requestExtra(runtime, model, request),
  };
  body.stream = true;
  return body;
}

export function createOpenAiChat(
  runtime: ProviderRuntime,
  warn: Warn = defaultWarn,
): ModelProvider {
  return {
    id: "openai-chat",
    model: "",
    async *stream(request, signal): AsyncGenerator<ModelEvent> {
      const model = modelConfig(runtime, request.model);
      const headers = requestHeaders(runtime, model, request);
      if (runtime.apiKey && !headers.authorization) {
        headers.authorization = `Bearer ${runtime.apiKey}`;
      }

      const response = await postStream({
        url: endpoint(runtime.baseUrl, "/chat/completions"),
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
      const toolCalls = new Map<number, StreamToolCall>();
      const details: unknown[] = [];
      let usage: ModelEvent | undefined;
      let finish: string | null | undefined;
      let sawDone = false;

      try {
        for await (const message of parseSse(response.body, signal)) {
          if (message.data === "[DONE]") {
            sawDone = true;
            break;
          }
          let chunk: ChatChunk;
          try {
            chunk = JSON.parse(message.data) as ChatChunk;
          } catch {
            continue;
          }

          if (chunk.error) {
            events.fail("server", chunk.error.message ?? "provider stream error");
          }
          const nextUsage = parseUsage(chunk.usage);
          if (nextUsage) usage = nextUsage;

          const choice = chunk.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finish = choice.finish_reason;

          const delta = choice.delta;
          if (!delta) continue;

          if (Array.isArray(delta.reasoning_details)) {
            mergeReasoningDetails(details, delta.reasoning_details);
          }
          const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.reasoning_text;
          if (typeof reasoning === "string" && reasoning.length > 0) {
            yield events.emit({ type: "reasoning", delta: reasoning });
          } else if (Array.isArray(delta.reasoning_details)) {
            const text = reasoningText(delta.reasoning_details);
            if (text.length > 0) yield events.emit({ type: "reasoning", delta: text });
          }

          const text = textContent(delta.content);
          if (text.length > 0) yield events.emit({ type: "text", delta: text });

          for (const part of delta.tool_calls ?? []) {
            const index = part.index ?? toolCalls.size;
            const previous = toolCalls.get(index) ?? {
              id: "",
              name: "",
              arguments: "",
            };
            if (part.id) previous.id = part.id;
            if (part.extra_content !== undefined) previous.extraContent = part.extra_content;
            if (part.function?.name) {
              previous.name = part.function.name;
              yield events.emit({ type: "tool_call_progress", index, name: part.function.name });
            }
            if (part.function?.arguments) {
              previous.arguments += part.function.arguments;
              yield events.emit({
                type: "tool_call_progress",
                index,
                delta: part.function.arguments,
              });
            }
            toolCalls.set(index, previous);
          }
        }
      } catch (error) {
        if (signal.aborted) throw error;
        events.interrupted(error, "[DONE]");
      }

      if (!sawDone) events.requireDone("[DONE]");

      const ordered = [...toolCalls.entries()].sort(([left], [right]) => left - right);
      const calls: ToolCall[] = [];
      for (const [index, call] of ordered) {
        if (!call.name) continue;
        const id = call.id || `call_${request.model}_${index}_${Date.now()}`;
        const args = call.arguments.trim().length > 0 ? parseToolArgs(call.arguments) : {};
        calls.push({
          id,
          name: call.name,
          args,
          ...(call.extraContent === undefined ? {} : { extraContent: call.extraContent }),
        });
        yield events.emit({
          type: "tool_call",
          id,
          name: call.name,
          args,
          ...(call.extraContent === undefined ? {} : { extraContent: call.extraContent }),
        });
      }

      if (isOpenRouter(runtime) && details.length > 0) {
        yield events.emit({ type: "provider_data", data: { kind: "openrouter", details } });
      }
      if (usage) yield events.emit(usage);
      yield events.done(mapFinish(finish, calls.length > 0));
    },
  };
}
