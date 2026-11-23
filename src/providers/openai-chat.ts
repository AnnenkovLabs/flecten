import type { ModelConfig } from "../config/schema";
import type { Message } from "../core/types";
import { isObject } from "../util/json";
import { streamChatResponse } from "./chat-stream";
import {
  apiModel,
  effectiveParallelTools,
  effortField,
  emptyReasoningValue,
  hasHeader,
  isOpenRouter,
  modelConfig,
  normalizeEffort,
  openAiThinking,
  promptCacheEnabled,
  replayMode,
  requestExtra,
  requestHeaders,
  supportsPromptCacheKey,
} from "./compat";
import { endpoint, postStream } from "./http";
import { chatMedia } from "./input-media";
import { usesCompletionTokens } from "./model-family";
import {
  defaultWarn,
  jsonSchemaFormat,
  openaiSchema,
  strictSchema,
  structuredOutputFormat,
  type Warn,
} from "./schema";
import type { ModelEvent, ModelProvider, ModelRequest, ProviderRuntime } from "./types";

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
          let parameters = openaiSchema(tool.parameters);
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
  const format = request.responseFormat ?? structuredOutputFormat(model);
  const responseFormat = format
    ? { type: "json_schema", json_schema: { name: format.name, ...jsonSchemaFormat(format, warn) } }
    : undefined;
  const hasTools = request.tools.length > 0;
  const parallel = hasTools ? effectiveParallelTools(runtime, model, request) : undefined;
  const cacheEnabled = promptCacheEnabled(runtime, model);
  const cacheKey = request.promptCacheKey || runtime.config.promptCacheKey;
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
    ...(request.temperature === undefined || model?.temperature === false
      ? {}
      : { temperature: request.temperature }),
    ...thinking,
    ...(isOpenRouter(runtime) ? openRouterEffort : effortPayload),
    ...(parallel === undefined ? {} : { parallel_tool_calls: parallel }),
    ...(cacheEnabled && cacheKey
      ? isOpenRouter(runtime)
        ? { session_id: cacheKey }
        : supportsPromptCacheKey(runtime, model)
          ? { prompt_cache_key: cacheKey }
          : {}
      : {}),
    ...(hasTools &&
    (request.toolChoice === "required" ||
      request.toolChoice === "none" ||
      request.toolChoice === "auto")
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
      if (runtime.apiKey && !hasHeader(headers, "authorization")) {
        headers.authorization = `Bearer ${runtime.apiKey}`;
      }

      const started = Date.now();
      const response = await postStream({
        url: endpoint(runtime.baseUrl, "/chat/completions"),
        headers,
        body: buildBody(request, runtime, warn),
        signal,
        providerId: runtime.providerId,
        model: apiModel(request),
        ...(model?.quotaGroup ? { quotaGroup: model.quotaGroup } : {}),
        ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
        ...(runtime.config.transport?.retries === undefined
          ? {}
          : { retries: runtime.config.transport.retries }),
      });
      yield* streamChatResponse(response, request, runtime, signal, started);
    },
  };
}
