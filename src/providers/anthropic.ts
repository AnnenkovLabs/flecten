import type { Message, ToolCall } from "../core/types";
import { isObject, parseToolArgs } from "../util/json";
import {
  apiModel,
  budgetFor,
  isAdaptiveAnthropic,
  modelConfig,
  normalizeEffort,
  promptCacheEnabled,
  requestExtra,
  requestHeaders,
} from "./compat";
import { endpoint, postStream } from "./http";
import { anthropicMedia } from "./input-media";
import { anthropicSchema, strictSchema, structuredOutputFormat } from "./schema";
import { parseSse, StreamEvents } from "./sse";
import type { StreamFinishReason } from "./stream-recovery";
import type { ModelEvent, ModelProvider, ModelRequest, ProviderRuntime } from "./types";

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface StreamBlock {
  index: number;
  type: "text" | "thinking" | "redacted_thinking" | "tool_use";
  text: string;
  partialJson: string;
  id: string;
  name: string;
  signature: string;
  data: string;
  stopped: boolean;
}

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

function convertMessages(messages: Message[]): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!message) break;

    if (message.role === "user") {
      pushUserBlocks(output, [
        { type: "text", text: message.content },
        ...(message.images ?? []).map(anthropicMedia),
      ]);
      index += 1;
      continue;
    }

    if (message.role === "assistant") {
      const raw = anthropicBlocks(message);
      if (raw && raw.length > 0) {
        output.push({ role: "assistant", content: raw });
        index += 1;
        continue;
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

  return output;
}

function thinkingConfig(request: ModelRequest, runtime: ProviderRuntime): Record<string, unknown> {
  const model = modelConfig(runtime, request.model);
  const effort =
    request.reasoning ?? (runtime.config.thinking === "enabled" ? ("medium" as const) : undefined);

  if (runtime.config.thinking === "disabled" || effort === "none") {
    return { thinking: { type: "disabled" } };
  }
  if (!effort) return {};
  if (!isAdaptiveAnthropic(request.model, model)) {
    const budget = budgetFor(effort, request.maxTokens);
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

function buildBody(request: ModelRequest, runtime: ProviderRuntime): Record<string, unknown> {
  const model = modelConfig(runtime, request.model);
  const thinking = thinkingConfig(request, runtime);
  const caching = promptCacheEnabled(runtime, model);
  const strictTools = model?.compat?.strictTools ?? runtime.config.strictTools;
  const tools =
    request.tools.length > 0
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
  const format = structuredOutputFormat(model);
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

  const body: Record<string, unknown> = {
    model: apiModel(request),
    max_tokens: request.maxTokens,
    system: caching
      ? [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }]
      : request.system,
    messages: convertMessages(request.messages),
    tools,
    stream: true,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(thinking.thinking ? { thinking: thinking.thinking } : {}),
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
    ...(request.toolChoice === "required"
      ? { tool_choice: { type: "any" } }
      : request.toolChoice === "none"
        ? { tool_choice: { type: "none" } }
        : request.toolChoice === "auto"
          ? { tool_choice: { type: "auto" } }
          : {}),
    ...requestExtra(runtime, model, request),
  };
  body.stream = true;
  return body;
}

interface UsageTotal {
  input: number;
  output: number;
  cached: number;
  cacheWrite?: number;
}

function mergeUsage(total: UsageTotal, usage: unknown): UsageTotal {
  if (!isObject(usage)) return total;
  const typed = usage as AnthropicUsage;
  const cacheRead =
    typeof typed.cache_read_input_tokens === "number"
      ? typed.cache_read_input_tokens
      : total.cached;
  const cacheWrite =
    typeof typed.cache_creation_input_tokens === "number"
      ? typed.cache_creation_input_tokens
      : total.cacheWrite;
  return {
    input:
      typeof typed.input_tokens === "number"
        ? typed.input_tokens + cacheRead + (cacheWrite ?? 0)
        : total.input,
    output: typeof typed.output_tokens === "number" ? typed.output_tokens : total.output,
    cached: cacheRead,
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
  };
}

function mapStop(reason: string | undefined, hasCalls: boolean): StreamFinishReason {
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "refusal") return "refusal";
  if (reason === "content_filter") return "content_filter";
  if (hasCalls || reason === "tool_use") return "tool_use";
  return "end";
}

function rawBlock(block: StreamBlock): Record<string, unknown> | undefined {
  if (block.type === "thinking") {
    return {
      type: "thinking",
      thinking: block.text,
      signature: block.signature,
    };
  }
  if (block.type === "redacted_thinking") {
    return { type: "redacted_thinking", data: block.data };
  }
  if (block.type === "text") {
    return block.text.length > 0 ? { type: "text", text: block.text } : undefined;
  }
  return {
    type: "tool_use",
    id: block.id,
    name: block.name,
    input: block.partialJson.trim().length > 0 ? parseToolArgs(block.partialJson) : {},
  };
}

export function createAnthropic(runtime: ProviderRuntime): ModelProvider {
  return {
    id: "anthropic-messages",
    model: "",
    async *stream(request, signal): AsyncGenerator<ModelEvent> {
      const model = modelConfig(runtime, request.model);
      const headers: Record<string, string> = {
        "anthropic-version": "2023-06-01",
        ...requestHeaders(runtime, model, request),
      };
      if (runtime.apiKey && !headers["x-api-key"]) headers["x-api-key"] = runtime.apiKey;
      const thinking = thinkingConfig(request, runtime);
      const format = structuredOutputFormat(model);
      const strictTools = model?.compat?.strictTools ?? runtime.config.strictTools;
      const betas = [
        ...(typeof thinking.beta === "string" && model?.interleavedReasoning !== false
          ? [thinking.beta]
          : []),
        ...(format !== undefined || strictTools ? ["structured-outputs-2025-11-13"] : []),
      ];
      if (betas.length > 0) {
        const previous = headers["anthropic-beta"]?.split(",").map((entry) => entry.trim()) ?? [];
        headers["anthropic-beta"] = [...new Set([...previous, ...betas])].join(",");
      }

      const response = await postStream({
        url: endpoint(runtime.baseUrl, "/v1/messages"),
        headers,
        body: buildBody(request, runtime),
        signal,
        providerId: runtime.providerId,
        ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
        ...(runtime.config.transport?.retries === undefined
          ? {}
          : { retries: runtime.config.transport.retries }),
      });
      if (!response.body) throw new Error("provider returned an empty body");

      const events = new StreamEvents();
      const blocks = new Map<number, StreamBlock>();
      const calls: ToolCall[] = [];
      let usage: UsageTotal = { input: 0, output: 0, cached: 0 };
      let stopReason: string | undefined;
      let sawStop = false;

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
          if (type === "error") {
            const error = isObject(event.error) ? event.error : event;
            events.fail(
              "server",
              typeof error.message === "string" ? error.message : "provider stream error",
            );
          }

          if (type === "message_start") {
            if (isObject(event.message)) {
              usage = mergeUsage(usage, event.message.usage);
            }
            continue;
          }

          if (type === "content_block_start" && isObject(event.content_block)) {
            const block = event.content_block;
            const index = typeof event.index === "number" ? event.index : blocks.size;
            if (block.type === "text") {
              blocks.set(index, {
                index,
                type: "text",
                text: typeof block.text === "string" ? block.text : "",
                partialJson: "",
                id: "",
                name: "",
                signature: "",
                data: "",
                stopped: false,
              });
            } else if (block.type === "thinking") {
              blocks.set(index, {
                index,
                type: "thinking",
                text: typeof block.thinking === "string" ? block.thinking : "",
                partialJson: "",
                id: "",
                name: "",
                signature: typeof block.signature === "string" ? block.signature : "",
                data: "",
                stopped: false,
              });
            } else if (block.type === "redacted_thinking") {
              blocks.set(index, {
                index,
                type: "redacted_thinking",
                text: "",
                partialJson: "",
                id: "",
                name: "",
                signature: "",
                data: typeof block.data === "string" ? block.data : "",
                stopped: false,
              });
            } else if (block.type === "tool_use") {
              const initial =
                isObject(block.input) && Object.keys(block.input).length > 0
                  ? JSON.stringify(block.input)
                  : "";
              const name = typeof block.name === "string" ? block.name : "";
              blocks.set(index, {
                index,
                type: "tool_use",
                text: "",
                partialJson: initial,
                id: typeof block.id === "string" ? block.id : "",
                name,
                signature: "",
                data: "",
                stopped: false,
              });
              if (name) yield events.emit({ type: "tool_call_progress", index, name });
              if (initial) yield events.emit({ type: "tool_call_progress", index, delta: initial });
            }
            continue;
          }

          if (type === "content_block_delta" && isObject(event.delta)) {
            const index = typeof event.index === "number" ? event.index : -1;
            const block = blocks.get(index);
            const delta = event.delta;
            if (!block) continue;
            if (delta.type === "text_delta" && typeof delta.text === "string") {
              block.text += delta.text;
              yield events.emit({ type: "text", delta: delta.text });
            } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
              block.text += delta.thinking;
              yield events.emit({ type: "reasoning", delta: delta.thinking });
            } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
              block.signature += delta.signature;
            } else if (
              delta.type === "input_json_delta" &&
              typeof delta.partial_json === "string"
            ) {
              block.partialJson += delta.partial_json;
              yield events.emit({ type: "tool_call_progress", index, delta: delta.partial_json });
            }
            continue;
          }

          if (type === "content_block_stop") {
            const index = typeof event.index === "number" ? event.index : -1;
            const block = blocks.get(index);
            if (block?.type === "tool_use" && !block.stopped) {
              block.stopped = true;
              const call: ToolCall = {
                id: block.id,
                name: block.name,
                args: parseToolArgs(block.partialJson || "{}"),
              };
              calls.push(call);
              yield events.emit({
                type: "tool_call",
                id: call.id,
                name: call.name,
                args: call.args,
              });
            }
            continue;
          }

          if (type === "message_delta") {
            if (isObject(event.delta) && typeof event.delta.stop_reason === "string") {
              stopReason = event.delta.stop_reason;
            }
            usage = mergeUsage(usage, event.usage);
            continue;
          }

          if (type === "message_stop") {
            sawStop = true;
            break;
          }
        }
      } catch (error) {
        if (signal.aborted) throw error;
        events.interrupted(error, "message_stop");
      }

      if (!sawStop) events.requireDone("message_stop");
      const ordered = [...blocks.values()]
        .sort((left, right) => left.index - right.index)
        .map(rawBlock)
        .filter((block): block is Record<string, unknown> => block !== undefined);
      if (ordered.length > 0) {
        yield events.emit({ type: "provider_data", data: { kind: "anthropic", blocks: ordered } });
      }
      if (usage.input > 0 || usage.output > 0) {
        yield events.emit({ type: "usage", ...usage });
      }
      yield events.done(mapStop(stopReason, calls.length > 0));
    },
  };
}
