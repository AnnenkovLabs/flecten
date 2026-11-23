import type { Message } from "../core/types";
import { isObject } from "../util/json";
import {
  apiModel,
  budgetFor,
  isAdaptiveAnthropic,
  modelConfig,
  normalizeEffort,
  promptCacheEnabled,
  requestExtra,
} from "./compat";
import { anthropicMedia } from "./input-media";
import { anthropicSchema, strictSchema, structuredOutputFormat } from "./schema";
import type { ModelRequest, ProviderRuntime } from "./types";

function pushUserBlocks(
  output: Record<string, unknown>[],
  blocks: Record<string, unknown>[],
): void {
  const last = output.at(-1);
  if (last?.role === "user" && Array.isArray(last.content)) {
    last.content.push(...blocks);
    return;
  }
  output.push({ role: "user", content: blocks });
}

function anthropicBlocks(message: Message): unknown[] | undefined {
  if (message.role !== "assistant" || !isObject(message.providerData)) return undefined;
  if (message.providerData.kind !== "anthropic") return undefined;
  return Array.isArray(message.providerData.blocks) ? message.providerData.blocks : undefined;
}

export function convertAnthropicMessages(
  messages: Message[],
  caching = false,
): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!message) break;

    if (message.role === "user") {
      const images = (message.images ?? []).map(anthropicMedia);
      const userBlocks: Record<string, unknown>[] = [
        ...(message.content.length > 0 || images.length === 0
          ? [{ type: "text", text: message.content }]
          : []),
        ...images,
      ];
      pushUserBlocks(output, userBlocks);
      index += 1;
      continue;
    }

    if (message.role === "assistant") {
      const raw = anthropicBlocks(message);
      if (raw && raw.length > 0) {
        const filtered = raw
          .filter(
            (entry) =>
              !(
                isObject(entry) &&
                entry.type === "thinking" &&
                (typeof entry.signature !== "string" || entry.signature.length === 0)
              ),
          )
          .map((entry) => (isObject(entry) ? { ...entry } : entry));
        if (filtered.length > 0) {
          output.push({ role: "assistant", content: filtered });
          index += 1;
          continue;
        }
      }
      const content: Record<string, unknown>[] = [];
      if (message.content.trim().length > 0) {
        content.push({ type: "text", text: message.content });
      }
      for (const call of message.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: isObject(call.args) ? call.args : {},
        });
      }
      if (content.length > 0) output.push({ role: "assistant", content });
      index += 1;
      continue;
    }

    const results: Record<string, unknown>[] = [];
    while (index < messages.length && messages[index]?.role === "tool") {
      const toolMessage = messages[index];
      if (toolMessage?.role !== "tool") break;
      results.push({
        type: "tool_result",
        tool_use_id: toolMessage.toolCallId,
        content: toolMessage.content,
        ...(toolMessage.isError ? { is_error: true } : {}),
      });
      index += 1;
    }
    if (results.length > 0) pushUserBlocks(output, results);
  }

  if (caching) {
    let remainingBreakpoints = 2;
    for (let msgIdx = output.length - 1; msgIdx >= 0 && remainingBreakpoints > 0; msgIdx -= 1) {
      const item = output[msgIdx];
      if (msgIdx < output.length - 1 && item?.role !== "user") continue;
      const blocks = Array.isArray(item?.content) ? item.content : undefined;
      for (let at = (blocks?.length ?? 0) - 1; blocks && at >= 0; at -= 1) {
        const block = blocks[at];
        if (!isObject(block)) continue;
        if (block.type === "thinking" || block.type === "redacted_thinking") continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.length === 0) {
          continue;
        }
        blocks[at] = { ...block, cache_control: { type: "ephemeral" } };
        remainingBreakpoints -= 1;
        break;
      }
    }
  }

  return output;
}

export function anthropicThinkingConfig(
  request: ModelRequest,
  runtime: ProviderRuntime,
): Record<string, unknown> {
  const model = modelConfig(runtime, request.model);
  if (model?.reasoning === false) return {};
  const effort =
    request.reasoning ?? (runtime.config.thinking === "enabled" ? ("medium" as const) : undefined);

  if (runtime.config.thinking === "disabled" || effort === "none") {
    return { thinking: { type: "disabled" } };
  }
  if (!effort) return {};
  if (!isAdaptiveAnthropic(request.model, model)) {
    const budget = budgetFor(effort, request.maxTokens, model?.reasoningBudget);
    if (budget < 1024) return {};
    return {
      thinking: { type: "enabled", budget_tokens: budget },
      beta: "interleaved-thinking-2025-05-14",
    };
  }
  return {
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: normalizeEffort(effort, model) },
  };
}

export function buildAnthropicBody(
  request: ModelRequest,
  runtime: ProviderRuntime,
): Record<string, unknown> {
  const model = modelConfig(runtime, request.model);
  const thinking = anthropicThinkingConfig(request, runtime);
  const caching = promptCacheEnabled(runtime, model);
  const strictTools = model?.compat?.strictTools ?? runtime.config.strictTools;
  const hasTools = request.tools.length > 0;
  const tools = hasTools
    ? request.tools.map((tool, index) => {
        const strict = strictTools ? strictSchema(tool.parameters) : undefined;
        return {
          name: tool.name,
          description: tool.description,
          input_schema: strict?.strict ? strict.schema : anthropicSchema(tool.parameters),
          ...(strict?.strict ? { strict: true } : {}),
          ...(caching && index === request.tools.length - 1
            ? { cache_control: { type: "ephemeral" } }
            : {}),
        };
      })
    : undefined;
  const format = request.responseFormat ?? structuredOutputFormat(model);
  const transformed = format?.strict ? strictSchema(format.schema) : undefined;
  const formatSchema = format
    ? transformed?.strict
      ? transformed.schema
      : anthropicSchema(format.schema)
    : undefined;
  const outputConfig = {
    ...(isObject(thinking.output_config) ? thinking.output_config : {}),
    ...(format && formatSchema ? { format: { type: "json_schema", schema: formatSchema } } : {}),
  };

  const thinkingActive = isObject(thinking.thinking) && thinking.thinking.type !== "disabled";
  const body: Record<string, unknown> = {
    model: apiModel(request),
    max_tokens: request.maxTokens,
    ...(request.system.length > 0
      ? {
          system: caching
            ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }]
            : request.system,
        }
      : {}),
    messages: convertAnthropicMessages(request.messages, caching),
    tools,
    stream: true,
    ...(request.temperature === undefined || thinkingActive || model?.temperature === false
      ? {}
      : { temperature: request.temperature }),
    ...(thinking.thinking ? { thinking: thinking.thinking } : {}),
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
    ...(hasTools && request.toolChoice === "required"
      ? { tool_choice: { type: "any" } }
      : hasTools && request.toolChoice === "none"
        ? { tool_choice: { type: "none" } }
        : hasTools && request.toolChoice === "auto"
          ? { tool_choice: { type: "auto" } }
          : {}),
    ...requestExtra(runtime, model, request),
  };
  body.stream = true;
  return body;
}
