import type { ToolCall } from "../core/types";
import { isObject, parseToolArgs } from "../util/json";
import { anthropicThinkingConfig, buildAnthropicBody } from "./anthropic-body";
import { apiModel, hasHeader, modelConfig, requestHeaders } from "./compat";
import { endpoint, postStream } from "./http";
import { structuredOutputFormat } from "./schema";
import { classifyStreamError, parseSse, StreamEvents } from "./sse";
import type { StreamFinishReason } from "./stream-recovery";
import type { ModelEvent, ModelProvider, ProviderRuntime } from "./types";

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
    return block.signature.length > 0
      ? { type: "thinking", thinking: block.text, signature: block.signature }
      : undefined;
  }
  if (block.type === "redacted_thinking") {
    return { type: "redacted_thinking", data: block.data };
  }
  if (block.type === "text") {
    return block.text.length > 0 ? { type: "text", text: block.text } : undefined;
  }
  if (!block.stopped) return undefined;
  const parsed = block.partialJson.trim().length > 0 ? parseToolArgs(block.partialJson) : {};
  return {
    type: "tool_use",
    id: block.id,
    name: block.name,
    input: isObject(parsed) ? parsed : {},
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
      if (
        runtime.apiKey &&
        !hasHeader(headers, "x-api-key") &&
        !hasHeader(headers, "authorization")
      ) {
        headers["x-api-key"] = runtime.apiKey;
      }
      const thinking = anthropicThinkingConfig(request, runtime);
      const format = request.responseFormat ?? structuredOutputFormat(model);
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
        body: buildAnthropicBody(request, runtime),
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
      const blocks = new Map<number, StreamBlock>();
      const calls: ToolCall[] = [];
      let usage: UsageTotal = { input: 0, output: 0, cached: 0 };
      let stopReason: string | undefined;
      let sawStop = false;
      let lastIndex = -1;

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

          if (type === "message_start") {
            if (isObject(event.message)) {
              usage = mergeUsage(usage, event.message.usage);
            }
            continue;
          }

          if (type === "content_block_start" && isObject(event.content_block)) {
            const block = event.content_block;
            const index = typeof event.index === "number" ? event.index : blocks.size;
            lastIndex = index;
            if (block.type === "text" || block.type === "thinking") {
              const isText = block.type === "text";
              const initial =
                typeof (isText ? block.text : block.thinking) === "string"
                  ? ((isText ? block.text : block.thinking) as string)
                  : "";
              blocks.set(index, {
                index,
                type: block.type,
                text: initial,
                partialJson: "",
                id: "",
                name: "",
                signature: !isText && typeof block.signature === "string" ? block.signature : "",
                data: "",
                stopped: false,
              });
              if (initial)
                yield events.emit({ type: isText ? "text" : "reasoning", delta: initial });
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
            const index = typeof event.index === "number" ? event.index : lastIndex;
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
            const index = typeof event.index === "number" ? event.index : lastIndex;
            const block = blocks.get(index);
            if (block?.type === "tool_use" && !block.stopped) {
              block.stopped = true;
              calls.push({
                id: block.id,
                name: block.name,
                args: parseToolArgs(block.partialJson || "{}"),
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
        if (usage.input > 0 || usage.output > 0) yield events.emit({ type: "usage", ...usage });
        if (signal.aborted) throw error;
        events.interrupted(error, "message_stop");
      }

      if (!sawStop) {
        if (usage.input > 0 || usage.output > 0) yield events.emit({ type: "usage", ...usage });
        events.requireDone("message_stop");
      }
      if (stopReason !== "max_tokens") {
        for (const block of blocks.values()) {
          if (block.type !== "tool_use" || block.stopped || !block.name) continue;
          const rawJson = block.partialJson.trim();
          let args: unknown = {};
          if (rawJson.length > 0) {
            try {
              args = JSON.parse(rawJson);
            } catch {
              continue;
            }
          }
          block.stopped = true;
          calls.push({ id: block.id, name: block.name, args: isObject(args) ? args : {} });
        }
      }
      for (const call of calls) {
        yield events.emit({ type: "tool_call", id: call.id, name: call.name, args: call.args });
      }
      const ordered = [...blocks.values()]
        .sort((left, right) => left.index - right.index)
        .map(rawBlock)
        .filter((block): block is Record<string, unknown> => block !== undefined);
      if (ordered.length > 0) {
        yield events.emit({ type: "provider_data", data: { kind: "anthropic", blocks: ordered } });
      }
      if (usage.input > 0 || usage.output > 0) yield events.emit({ type: "usage", ...usage });
      yield events.done(mapStop(stopReason, calls.length > 0));
    },
  };
}
