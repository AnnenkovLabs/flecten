import { isObject } from "../util/json";
import { type ChatChunk, ChatChunkSchema } from "./chat-stream-schema";
import { isOpenRouter } from "./compat";
import { type ProviderResponse, ProviderResponseError, responseLabel } from "./response";
import { parseSse, StreamEvents } from "./sse";
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
    input: usage.prompt_tokens ?? 0,
    output: usage.completion_tokens ?? 0,
    cached: usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0,
    ...(reasoning === undefined ? {} : { reasoning }),
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
      if (chunk.error !== undefined) events.fail("server", "provider returned a stream error");
      if (
        chunk.usage &&
        typeof chunk.usage.prompt_tokens === "number" &&
        typeof chunk.usage.completion_tokens === "number"
      ) {
        usage = usageEvent(chunk.usage);
        evidence.usage = "reported";
      }
      const choice = chunk.choices?.[0];
      if (!choice) {
        if (!chunk.usage) {
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
        if (!choice.finish_reason) {
          evidence.unsupportedFrames += 1;
          fail("unsupported_choice");
        }
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
      if (
        "function_call" in delta ||
        (Object.keys(delta).length > 0 && !known.some((key) => key in delta))
      ) {
        evidence.unsupportedFrames += 1;
        fail("unsupported_delta");
      }
      if (delta.refusal) fail("refusal");
      if (delta.reasoning_details) mergeDetails(details, delta.reasoning_details);
      const reasoning =
        delta.reasoning_content ??
        delta.reasoning ??
        delta.reasoning_text ??
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
          .join("") ??
        "";
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
        const previous = calls.get(part.index) ?? { id: "", name: "", arguments: "" };
        if (part.id) previous.id = part.id;
        if (part.extra_content !== undefined) previous.extraContent = part.extra_content;
        if (part.function?.name) {
          previous.name += part.function.name;
          yield events.emit({ type: "tool_call_progress", index: part.index, name: previous.name });
        }
        if (part.function?.arguments) {
          previous.arguments += part.function.arguments;
          yield events.emit({
            type: "tool_call_progress",
            index: part.index,
            delta: part.function.arguments,
          });
        }
        calls.set(part.index, previous);
      }
    }
    if (!evidence.terminal) events.requireDone("[DONE]");
    // Compatible providers may omit finish_reason even after an explicit [DONE].
    const reason = finish ? FINISH[finish] : calls.size > 0 ? "tool_use" : "end";
    if (!reason) fail("unknown_finish_reason");
    if (reason === "content_filter" || reason === "refusal") fail(reason);
    const completed: Array<Extract<ModelEvent, { type: "tool_call" }>> = [];
    for (const [, call] of [...calls].sort(([a], [b]) => a - b)) {
      let args: unknown;
      try {
        args = JSON.parse(call.arguments);
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
