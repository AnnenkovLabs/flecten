import type { Event, SessionEvent } from "../core/types";

/** Keep lifecycle evidence without prompts, model text, tool arguments or tool output. */
export function operationalData(event: Event | SessionEvent): Record<string, unknown> {
  if (event.type === "worker.event" || event.type === "subagent.event") {
    return {
      type: event.event.type,
      sessionId: event.event.sessionId,
      data: operationalData(event.event),
    };
  }
  switch (event.type) {
    case "context.summary.failed":
      return { stage: event.stage, reason: event.reason };
    case "usage.unavailable":
      return {
        provider: event.provider,
        model: event.model,
        purpose: event.purpose,
        status: "unavailable",
      };
    case "task.budget":
    case "budget":
      return { ...event.budget };
    case "provider.response":
      return { ...event.response };
    case "provider.retry":
      return {
        kind: event.kind,
        attempt: event.attempt,
        delayMs: event.delayMs,
        until: event.until,
        reason: event.reason,
      };
    case "turn.started":
      return { turn: event.turn };
    case "turn.finished":
      return { turn: event.turn, reason: event.reason };
    case "message.finished":
      return {
        textCharacters: event.text.length,
        reasoningCharacters: event.reasoning.length,
        toolCalls: event.toolCalls.length,
      };
    case "tool.finished":
      return { tool: event.call.name, ok: event.result.ok, durationMs: event.result.durationMs };
    case "session.finished":
      return {
        reason: event.result.stopReason,
        turns: event.result.turns,
        usage: event.result.usage,
      };
    case "context.usage":
      return {
        used: event.used,
        window: event.window,
        reserve: event.reserve,
        source: event.source,
      };
    case "usage":
      return {
        usage: event.usage,
        provider: event.provider,
        model: event.model,
        purpose: event.purpose,
      };
    default:
      return {};
  }
}

export function transientDiagnostic(event: Event | SessionEvent): boolean {
  if (event.type === "worker.event" || event.type === "subagent.event")
    return transientDiagnostic(event.event);
  return (
    event.type === "message.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "tool_call.progress"
  );
}
