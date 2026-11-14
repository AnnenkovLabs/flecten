import { HarnessError } from "../errors";
import {
  assessStream,
  type StreamErrorKind,
  type StreamFinishReason,
  StreamTracker,
} from "./stream-recovery";
import type { ModelEvent, StopReason } from "./types";

export interface SseMessage {
  event: string;
  data: string;
}

function isStopReason(reason: StreamFinishReason): reason is StopReason {
  return reason === "end" || reason === "tool_use" || reason === "max_tokens";
}

function retryKind(kind: StreamErrorKind): "network" | "rate_limit" | "server" | "unknown" {
  if (kind === "timeout" || kind === "network") return "network";
  if (kind === "rate_limit") return "rate_limit";
  if (kind === "server") return "server";
  return "unknown";
}

export class StreamError extends HarnessError {
  readonly kind: "network" | "rate_limit" | "server" | "unknown";
  readonly retryable: boolean;

  constructor(message: string, kind: StreamErrorKind, options: { cause?: unknown } = {}) {
    super("provider_failed", message, options);
    this.name = "StreamError";
    this.kind = retryKind(kind);
    this.retryable = this.kind !== "unknown";
  }
}

export class StreamEvents {
  private readonly tracker = new StreamTracker();

  emit(event: ModelEvent): ModelEvent {
    this.tracker.feed(event);
    return event;
  }

  done(reason: StreamFinishReason): ModelEvent {
    this.tracker.feed({ type: "done", reason });
    if (!isStopReason(reason)) {
      const assessment = assessStream(this.tracker);
      throw new StreamError(`provider stream stopped: ${assessment.reason}`, "unknown");
    }
    return { type: "done", reason };
  }

  fail(kind: StreamErrorKind, message: string): never {
    this.tracker.feed({ type: "error", kind, message });
    const assessment = assessStream(this.tracker);
    throw new StreamError(`provider stream failed: ${assessment.reason}`, kind);
  }

  requireDone(terminal: string): void {
    if (this.tracker.sawDone) return;
    this.tracker.feed({
      type: "error",
      kind: "network",
      message: `stream ended before ${terminal}`,
    });
    const assessment = assessStream(this.tracker);
    throw new StreamError(
      `provider stream incomplete: ${assessment.reason}; missing ${terminal}`,
      "network",
    );
  }

  interrupted(error: unknown, terminal: string): never {
    if (error instanceof HarnessError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    this.tracker.feed({ type: "error", kind: "network", message });
    const assessment = assessStream(this.tracker);
    throw new StreamError(
      `provider stream incomplete: ${assessment.reason}; interrupted before ${terminal}`,
      "network",
      { cause: error },
    );
  }
}

export async function* parseSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let skipLf = false;
  let event = "";
  let data: string[] = [];

  function* dispatch(): Generator<SseMessage> {
    if (data.length > 0) {
      yield { event, data: data.join("\n") };
    }
    event = "";
    data = [];
  }

  function* consumeLine(line: string): Generator<SseMessage> {
    if (line.length === 0) {
      yield* dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      return;
    }
    if (line.startsWith("data:")) {
      const value = line.slice(5);
      data.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const character of chunk) {
        if (skipLf) {
          skipLf = false;
          if (character === "\n") continue;
        }
        if (character === "\r" || character === "\n") {
          const line = buffer;
          buffer = "";
          skipLf = character === "\r";
          yield* consumeLine(line);
        } else {
          buffer += character;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      yield* consumeLine(buffer);
    }
    yield* dispatch();
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Aborted", "AbortError");
    }
  } finally {
    reader.releaseLock();
  }
}
