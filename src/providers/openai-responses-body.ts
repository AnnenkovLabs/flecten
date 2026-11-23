import type { Message } from "../core/types";
import { isObject } from "../util/json";
import {
  apiModel,
  effectiveParallelTools,
  modelConfig,
  normalizeEffort,
  promptCacheEnabled,
  requestExtra,
  supportsPromptCacheKey,
} from "./compat";
import { responsesMedia } from "./input-media";
import {
  jsonSchemaFormat,
  openaiSchema,
  strictSchema,
  structuredOutputFormat,
  type Warn,
} from "./schema";
import type { ModelRequest, ProviderRuntime } from "./types";

function responseItems(message: Message): unknown[] | undefined {
  if (message.role !== "assistant" || !isObject(message.providerData)) return undefined;
  if (message.providerData.kind !== "openai-responses") return undefined;
  return Array.isArray(message.providerData.items) ? message.providerData.items : undefined;
}

export function convertResponsesInput(message: Message): Record<string, unknown>[] {
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

function reasoningPayload(
  request: ModelRequest,
  runtime: ProviderRuntime,
  model: ReturnType<typeof modelConfig>,
): Record<string, unknown> {
  if (model?.reasoning === false || runtime.config.thinking === "disabled") return {};
  if (request.reasoning === "none") {
    return model?.reasoningLevels?.includes("none") ? { reasoning: { effort: "none" } } : {};
  }
  if (request.reasoning !== undefined) {
    return {
      reasoning: {
        effort: normalizeEffort(request.reasoning, model),
        summary: "auto",
      },
    };
  }
  return model?.reasoning ? { reasoning: { summary: "auto" } } : {};
}

export function buildResponsesBody(
  request: ModelRequest,
  runtime: ProviderRuntime,
  warn: Warn,
): Record<string, unknown> {
  const model = modelConfig(runtime, request.model);
  const reasoning = reasoningPayload(request, runtime, model);
  const hasTools = request.tools.length > 0;
  const parallel = hasTools ? effectiveParallelTools(runtime, model, request) : undefined;
  const cacheEnabled = promptCacheEnabled(runtime, model) && supportsPromptCacheKey(runtime, model);
  const cacheKey = request.promptCacheKey || runtime.config.promptCacheKey;
  const strictTools = model?.compat?.strictTools ?? runtime.config.strictTools;
  const format = request.responseFormat ?? structuredOutputFormat(model);
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
    input: request.messages.flatMap(convertResponsesInput),
    tools: hasTools
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
            name: tool.name,
            description: tool.description,
            parameters,
            ...(strict ? { strict: true } : {}),
          };
        })
      : undefined,
    stream: true,
    store: false,
    ...(model?.reasoning === false ? {} : { include: ["reasoning.encrypted_content"] }),
    max_output_tokens: request.maxTokens,
    ...text,
    ...(request.temperature === undefined || model?.temperature === false
      ? {}
      : { temperature: request.temperature }),
    ...reasoning,
    ...(parallel === undefined ? {} : { parallel_tool_calls: parallel }),
    ...(cacheEnabled && cacheKey ? { prompt_cache_key: cacheKey } : {}),
    ...(hasTools &&
    (request.toolChoice === "required" ||
      request.toolChoice === "none" ||
      request.toolChoice === "auto")
      ? { tool_choice: request.toolChoice }
      : {}),
    ...requestExtra(runtime, model, request),
  };
  body.stream = true;
  return body;
}
