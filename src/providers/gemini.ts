import type { Message, ToolCall } from "../core/types";
import { isObject } from "../util/json";
import { trimTrailingSlashes } from "../util/text";
import { apiModel, geminiThinking, modelConfig, requestExtra, requestHeaders } from "./compat";
import { postStream } from "./http";
import { geminiSchema, structuredOutputFormat } from "./schema";
import { parseSse, StreamEvents } from "./sse";
import type { StreamFinishReason } from "./stream-recovery";
import type { ModelEvent, ModelProvider, ModelRequest, ProviderRuntime } from "./types";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name?: string; response?: unknown };
}

interface GeminiUsage {
  promptTokenCount?: number | undefined;
  candidatesTokenCount?: number | undefined;
  thoughtsTokenCount?: number | undefined;
  cachedContentTokenCount?: number | undefined;
}

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[]; role?: string };
    finishReason?: string;
  }>;
  usageMetadata?: GeminiUsage;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

function geminiParts(message: Message): GeminiPart[] | undefined {
  if (message.role !== "assistant" || !isObject(message.providerData)) return undefined;
  if (message.providerData.kind !== "gemini") return undefined;
  return Array.isArray(message.providerData.parts)
    ? (message.providerData.parts as GeminiPart[])
    : undefined;
}

function convertMessages(messages: Message[]): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!message) break;

    if (message.role === "user") {
      output.push({
        role: "user",
        parts: [
          { text: message.content },
          ...(message.images ?? []).map((image) => ({
            inlineData: { mimeType: image.mediaType, data: image.data },
          })),
        ],
      });
      index += 1;
      continue;
    }

    if (message.role === "assistant") {
      const raw = geminiParts(message);
      if (raw && raw.length > 0) {
        output.push({ role: "model", parts: raw });
        index += 1;
        continue;
      }
      const parts: GeminiPart[] = [];
      if (message.content.length > 0) parts.push({ text: message.content });
      for (const call of message.toolCalls) {
        parts.push({
          functionCall: { name: call.name, args: call.args },
          ...(isObject(call.extraContent) && typeof call.extraContent.thoughtSignature === "string"
            ? { thoughtSignature: call.extraContent.thoughtSignature }
            : {}),
        });
      }
      if (parts.length > 0) output.push({ role: "model", parts });
      index += 1;
      continue;
    }

    const parts: GeminiPart[] = [];
    while (index < messages.length && messages[index]?.role === "tool") {
      const toolMessage = messages[index];
      if (toolMessage?.role !== "tool") break;
      parts.push({
        functionResponse: {
          name: toolMessage.name,
          response: {
            result: toolMessage.content,
            ...(toolMessage.isError ? { error: true } : {}),
          },
        },
      });
      index += 1;
    }
    if (parts.length > 0) output.push({ role: "user", parts });
  }

  return output;
}

function buildBody(request: ModelRequest, runtime: ProviderRuntime): Record<string, unknown> {
  const model = modelConfig(runtime, request.model);
  const thinking = geminiThinking(request.model, model, request.reasoning) as {
    thinkingConfig?: Record<string, unknown>;
  };
  const format = structuredOutputFormat(model);
  const body: Record<string, unknown> = {
    contents: convertMessages(request.messages),
    systemInstruction: { parts: [{ text: request.system }] },
    tools:
      request.tools.length > 0
        ? [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: geminiSchema(tool.parameters),
              })),
            },
          ]
        : undefined,
    generationConfig: {
      maxOutputTokens: request.maxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(thinking.thinkingConfig ? { thinkingConfig: thinking.thinkingConfig } : {}),
      ...(format
        ? {
            responseMimeType: "application/json",
            responseSchema: geminiSchema(format.schema),
          }
        : {}),
    },
    ...(request.toolChoice === "required"
      ? { toolConfig: { functionCallingConfig: { mode: "ANY" } } }
      : request.toolChoice === "none"
        ? { toolConfig: { functionCallingConfig: { mode: "NONE" } } }
        : request.toolChoice === "auto"
          ? { toolConfig: { functionCallingConfig: { mode: "AUTO" } } }
          : {}),
    ...requestExtra(runtime, model, request),
  };
  return body;
}

function streamUrl(baseUrl: string, model: string): string {
  const base = trimTrailingSlashes(baseUrl);
  return `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
}

function mergeUsage(total: GeminiUsage, usage: GeminiUsage | undefined): GeminiUsage {
  if (!usage) return total;
  return {
    promptTokenCount: usage.promptTokenCount ?? total.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount ?? total.candidatesTokenCount,
    thoughtsTokenCount: usage.thoughtsTokenCount ?? total.thoughtsTokenCount,
    cachedContentTokenCount: usage.cachedContentTokenCount ?? total.cachedContentTokenCount,
  };
}

function mapFinish(reason: string | undefined, calls: number): StreamFinishReason {
  if (reason === "MAX_TOKENS") return "max_tokens";
  if (reason === "SAFETY") return "safety";
  if (
    reason === "RECITATION" ||
    reason === "BLOCKLIST" ||
    reason === "PROHIBITED_CONTENT" ||
    reason === "SPII"
  ) {
    return "content_filter";
  }
  if (calls > 0) return "tool_use";
  return "end";
}

function appendPart(parts: GeminiPart[], part: GeminiPart): void {
  const last = parts.at(-1);
  if (part.text !== undefined && part.text.length > 0) {
    if (
      last &&
      last.text !== undefined &&
      !last.functionCall &&
      (last.thought ?? false) === (part.thought ?? false)
    ) {
      last.text += part.text;
      if (part.thoughtSignature) {
        last.thoughtSignature = `${last.thoughtSignature ?? ""}${part.thoughtSignature}`;
      }
    } else {
      parts.push({ ...part });
    }
  } else if (part.thoughtSignature) {
    if (last) last.thoughtSignature = `${last.thoughtSignature ?? ""}${part.thoughtSignature}`;
    else parts.push({ text: "", thoughtSignature: part.thoughtSignature });
  } else if (part.functionCall) {
    parts.push({ ...part });
  }
}

export function createGemini(runtime: ProviderRuntime): ModelProvider {
  return {
    id: "gemini",
    model: "",
    async *stream(request, signal): AsyncGenerator<ModelEvent> {
      const model = modelConfig(runtime, request.model);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...requestHeaders(runtime, model, request),
      };
      if (runtime.apiKey && !headers["x-goog-api-key"]) headers["x-goog-api-key"] = runtime.apiKey;

      const response = await postStream({
        url: streamUrl(runtime.baseUrl, apiModel(request)),
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
      const parts: GeminiPart[] = [];
      const calls: ToolCall[] = [];
      let usage: GeminiUsage = {};
      let finish: string | undefined;
      let callIndex = 0;

      try {
        for await (const message of parseSse(response.body, signal)) {
          let chunk: GeminiChunk;
          try {
            chunk = JSON.parse(message.data) as GeminiChunk;
          } catch {
            continue;
          }
          if (chunk.error) events.fail("server", chunk.error.message ?? "provider stream error");
          if (chunk.promptFeedback?.blockReason) {
            events.fail(
              "safety",
              `Gemini blocked the request: ${chunk.promptFeedback.blockReason}`,
            );
          }
          usage = mergeUsage(usage, chunk.usageMetadata);

          for (const candidate of chunk.candidates ?? []) {
            if (candidate.finishReason) finish = candidate.finishReason;
            for (const part of candidate.content?.parts ?? []) {
              appendPart(parts, part);
              if (part.text && part.thought) {
                yield events.emit({ type: "reasoning", delta: part.text });
              } else if (part.text) {
                yield events.emit({ type: "text", delta: part.text });
              }
              if (part.functionCall?.name) {
                const name = part.functionCall.name;
                const args = isObject(part.functionCall.args) ? part.functionCall.args : {};
                const id = `call_gemini_${callIndex}_${Date.now()}`;
                callIndex += 1;
                const call: ToolCall = {
                  id,
                  name,
                  args,
                  ...(part.thoughtSignature === undefined
                    ? {}
                    : { extraContent: { thoughtSignature: part.thoughtSignature } }),
                };
                calls.push(call);
                yield events.emit({ type: "tool_call_progress", index: callIndex - 1, name });
                yield events.emit({ type: "tool_call", id, name, args });
              }
            }
          }
        }
      } catch (error) {
        if (signal.aborted) throw error;
        events.interrupted(error, "finishReason");
      }

      if (finish === undefined) events.requireDone("finishReason");

      if (parts.length > 0) {
        yield events.emit({ type: "provider_data", data: { kind: "gemini", parts } });
      }
      const input = usage.promptTokenCount ?? 0;
      const output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
      const cached = usage.cachedContentTokenCount ?? 0;
      if (input > 0 || output > 0) {
        yield events.emit({
          type: "usage",
          input,
          output,
          cached,
          ...(usage.thoughtsTokenCount === undefined
            ? {}
            : { reasoning: usage.thoughtsTokenCount }),
        });
      }
      yield events.done(mapFinish(finish, calls.length));
    },
  };
}
