import { isObject } from "../util/json";
import { type ChatChunk, ChatChunkSchema } from "./chat-stream-schema";
import { isOpenRouter } from "./compat";
import { type ProviderResponse, ProviderResponseError, responseLabel } from "./response";
import { classifyStreamError, parseSse, StreamError, StreamEvents } from "./sse";
import type { StreamFinishReason } from "./stream-recovery";
import { sanitizeBody } from "./transport";
import type { ModelEvent, ModelRequest, ProviderRuntime } from "./types";

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
  extraContent?: unknown;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isObject(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function mergeDetails(target: unknown[], incoming: unknown[]): void {
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
    const merged = { ...existing, ...part };
    for (const key of ["text", "summary"]) {
      const previous = typeof existing[key] === "string" ? existing[key] : "";
      const next = typeof part[key] === "string" ? part[key] : "";
      if (previous || next) merged[key] = previous + next;
    }
    target[index] = merged;
  }
}

function usageEvent(usage: NonNullable<ChatChunk["usage"]>): ModelEvent {
  const reasoning =
    usage.completion_tokens_details?.reasoning_tokens ??
    usage.output_tokens_details?.reasoning_tokens;
  return {
    type: "usage",
    input: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    output: usage.completion_tokens ?? usage.output_tokens ?? 0,
    cached: usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0,
    ...(typeof reasoning === "number" ? { reasoning } : {}),
  };
}

const FINISH: Record<string, StreamFinishReason> = {
  stop: "end",
  length: "max_tokens",
  tool_calls: "tool_use",
  function_call: "tool_use",
  content_filter: "content_filter",
  refusal: "refusal",
};

export async function* streamChatResponse(
  response: Response,
  request: ModelRequest,
  runtime: ProviderRuntime,
  signal: AbortSignal,
  started = Date.now(),
): AsyncGenerator<ModelEvent> {
  const label = (value: string | null): string | undefined =>
    value === null
      ? undefined
      : responseLabel(
          sanitizeBody(value, { ...runtime.headers, authorization: runtime.apiKey ?? "" }),
        );
  const requestId = label(
    response.headers.get("x-request-id") ?? response.headers.get("request-id"),
  );
  const evidence: ProviderResponse = {
    protocol: "openai-chat",
    status: "failed",
    outcome: "incomplete",
    frames: 0,
    invalidFrames: 0,
    unsupportedFrames: 0,
    textBytes: 0,
    reasoningBytes: 0,
    toolCalls: 0,
    usage: "missing",
    terminal: false,
    durationMs: 0,
    ...(requestId ? { requestId } : {}),
  };
  const snapshot = (
    outcome: string,
    status: ProviderResponse["status"] = "failed",
  ): ProviderResponse => ({
    ...evidence,
    status,
    outcome,
    durationMs: Date.now() - started,
  });
  const fail: (outcome: string) => never = (outcome) => {
    throw new ProviderResponseError(snapshot(outcome));
  };
  const events = new StreamEvents();
  const calls = new Map<number, PendingCall>();
  const slotById = new Map<string, number>();
  const slotByIndex = new Map<number, number>();
  let nextSlot = 0;
  let lastSlot: number | undefined;
  const details: unknown[] = [];
  const encoder = new TextEncoder();
  let finish: string | undefined;
  let usage: ModelEvent | undefined;
  let usageEmitted = false;
  let visible = false;
  try {
    if (!response.body) fail("empty_body");
    for await (const frame of parseSse(response.body, signal)) {
      evidence.frames += 1;
      if (frame.data === "[DONE]") {
        evidence.terminal = true;
        break;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(frame.data);
      } catch {
        evidence.invalidFrames += 1;
        fail("malformed_json");
      }
      const parsed = ChatChunkSchema.safeParse(raw);
      if (!parsed.success) {
        evidence.invalidFrames += 1;
        fail("invalid_chunk");
      }
      const chunk = parsed.data;
      if (chunk.error !== undefined) {
        const classified = classifyStreamError(chunk.error);
        const safeMessage = sanitizeBody(classified.message, {
          ...runtime.headers,
          authorization: runtime.apiKey ?? "",
        });
        throw new ProviderResponseError(
          snapshot("provider_error"),
          new StreamError(safeMessage, classified.kind),
        );
      }
      const promptTokens = chunk.usage?.prompt_tokens ?? chunk.usage?.input_tokens;
      const completionTokens = chunk.usage?.completion_tokens ?? chunk.usage?.output_tokens;
      if (chunk.usage && typeof promptTokens === "number" && typeof completionTokens === "number") {
        usage = usageEvent(chunk.usage);
        evidence.usage = "reported";
      }
      const choice = chunk.choices?.[0];
      if (!choice) {
        if (!chunk.usage && !Array.isArray(chunk.choices)) {
          evidence.unsupportedFrames += 1;
          fail("unsupported_chunk");
        }
        continue;
      }
      if ("message" in choice) {
        evidence.unsupportedFrames += 1;
        fail("unsupported_choice");
      }
      if (choice.finish_reason) {
        finish = choice.finish_reason;
        evidence.originalFinishReason = label(finish) ?? "[invalid]";
        if (!Object.hasOwn(FINISH, finish)) fail("unknown_finish_reason");
      }
      const delta = choice.delta;
      if (!delta) {
        continue;
      }
      const known = [
        "role",
        "content",
        "reasoning_content",
        "reasoning",
        "reasoning_text",
        "reasoning_details",
        "refusal",
        "tool_calls",
      ];
      const fnCall = delta.function_call;
      const hasActiveFunctionCall =
        fnCall !== undefined &&
        fnCall !== null &&
        ((typeof fnCall.name === "string" && fnCall.name.length > 0) ||
          (typeof fnCall.arguments === "string" && fnCall.arguments.length > 0));
      const deltaKeys = Object.keys(delta).filter(
        (key) => !(key === "function_call" && !hasActiveFunctionCall),
      );
      if (hasActiveFunctionCall || (deltaKeys.length > 0 && !known.some((key) => key in delta))) {
        evidence.unsupportedFrames += 1;
        fail("unsupported_delta");
      }
      if (delta.refusal) fail("refusal");
      if (delta.reasoning_details) mergeDetails(details, delta.reasoning_details);
      const detailReasoning =
        delta.reasoning_details
          ?.map((part) =>
            isObject(part)
              ? typeof part.text === "string"
                ? part.text
                : typeof part.summary === "string"
                  ? part.summary
                  : ""
              : "",
          )
          .join("") ?? "";
      const reasoning =
        [delta.reasoning_content, delta.reasoning, delta.reasoning_text, detailReasoning].find(
          (value): value is string => typeof value === "string" && value.length > 0,
        ) ?? "";
      if (reasoning.length > 0) {
        evidence.reasoningBytes += encoder.encode(reasoning).byteLength;
        yield events.emit({ type: "reasoning", delta: reasoning });
      }
      const text = textContent(delta.content);
      if (text.length > 0) {
        visible ||= text.trim().length > 0;
        evidence.textBytes += encoder.encode(text).byteLength;
        yield events.emit({ type: "text", delta: text });
      }
      for (const part of delta.tool_calls ?? []) {
        const partId = typeof part.id === "string" && part.id.length > 0 ? part.id : "";
        const partIndex = typeof part.index === "number" ? part.index : undefined;
        let slot: number;
        if (partId && slotById.has(partId)) {
          slot = slotById.get(partId) as number;
        } else if (partIndex !== undefined && slotByIndex.has(partIndex)) {
          const candidate = slotByIndex.get(partIndex) as number;
          const existing = calls.get(candidate);
          if (partId && existing?.id && existing.id !== partId) {
            slot = nextSlot++;
            slotByIndex.set(partIndex, slot);
          } else {
            slot = candidate;
          }
        } else if (partIndex === undefined && !partId && lastSlot !== undefined) {
          slot = lastSlot;
        } else {
          slot = nextSlot++;
        }
        if (partId) slotById.set(partId, slot);
        if (partIndex !== undefined) slotByIndex.set(partIndex, slot);
        lastSlot = slot;
        const previous = calls.get(slot) ?? { id: "", name: "", arguments: "" };
        if (partId) previous.id = partId;
        if (part.extra_content !== undefined) previous.extraContent = part.extra_content;
        if (part.function?.name) {
          const chunkName = part.function.name;
          if (!previous.name) {
            previous.name = chunkName;
            yield events.emit({ type: "tool_call_progress", index: slot, name: previous.name });
          } else if (
            chunkName !== previous.name &&
            !request.tools.some((tool) => tool.name === previous.name)
          ) {
            previous.name += chunkName;
            yield events.emit({ type: "tool_call_progress", index: slot, name: previous.name });
          }
        }
        if (part.function?.arguments) {
          previous.arguments += part.function.arguments;
          yield events.emit({
            type: "tool_call_progress",
            index: slot,
            delta: part.function.arguments,
          });
        }
        calls.set(slot, previous);
      }
    }
    if (!evidence.terminal) events.requireDone("[DONE]");
    // Compatible providers may omit finish_reason even after an explicit [DONE].
    const mappedFinish = finish ? FINISH[finish] : undefined;
    const reason = mappedFinish
      ? mappedFinish === "end" && calls.size > 0
        ? "tool_use"
        : mappedFinish
      : finish
        ? undefined
        : calls.size > 0
          ? "tool_use"
          : "end";
    if (!reason) fail("unknown_finish_reason");
    if (reason === "content_filter" || reason === "refusal") fail(reason);
    const completed: Array<Extract<ModelEvent, { type: "tool_call" }>> = [];
    for (const [, call] of [...calls].sort(([a], [b]) => a - b)) {
      let args: unknown;
      const rawArgs =
        call.arguments.trim().length === 0 && call.id && call.name ? "{}" : call.arguments;
      try {
        args = JSON.parse(rawArgs);
      } catch {
        if (reason === "max_tokens") continue;
        fail("incomplete_tool_arguments");
      }
      if (!call.id || !call.name || !isObject(args)) {
        if (reason === "max_tokens") continue;
        fail("incomplete_tool_call");
      }
      if (!request.tools.some((tool) => tool.name === call.name)) fail("unknown_tool_call");
      completed.push({
        type: "tool_call",
        id: call.id,
        name: call.name,
        args,
        ...(call.extraContent === undefined ? {} : { extraContent: call.extraContent }),
      });
    }
    evidence.toolCalls = completed.length;
    if (reason === "tool_use" && completed.length === 0) fail("missing_tool_call");
    if (reason !== "max_tokens" && !visible && completed.length === 0)
      fail(evidence.reasoningBytes > 0 ? "reasoning_only" : "empty_completion");
    for (const call of completed) yield events.emit(call);
    if (isOpenRouter(runtime) && details.length > 0)
      yield events.emit({ type: "provider_data", data: { kind: "openrouter", details } });
    if (usage) {
      usageEmitted = true;
      yield events.emit(usage);
    }
    const done = events.done(reason);
    if (done.type !== "done") throw new Error("expected a terminal model event");
    yield { ...done, response: snapshot(reason, "complete") };
  } catch (error) {
    if (usage && !usageEmitted) yield events.emit(usage);
    if (error instanceof ProviderResponseError) {
      yield { type: "response", response: error.response };
      throw error;
    }
    if (signal.aborted) throw error;
    try {
      events.interrupted(error, "[DONE]");
    } catch (failure) {
      const wrapped = new ProviderResponseError(snapshot("incomplete"), failure);
      yield { type: "response", response: wrapped.response };
      throw wrapped;
    }
  }
}
