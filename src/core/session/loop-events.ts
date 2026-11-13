import type { LoopEvent } from "../loop/types";
import type { Event, SessionId } from "../types";

/** Loop events carry no session id; the session stamps it before they reach the bus and disk. */
export function mapLoopEvent(event: LoopEvent, sessionId: SessionId): Event {
  switch (event.type) {
    case "turn.started":
      return { type: "turn.started", sessionId, turn: event.turn };
    case "message.delta":
      return { type: "message.delta", sessionId, text: event.text };
    case "message.started":
      return { type: "message.started", sessionId };
    case "reasoning.delta":
      return { type: "reasoning.delta", sessionId, text: event.text };
    case "message.finished":
      return {
        type: "message.finished",
        sessionId,
        text: event.text,
        reasoning: event.reasoning,
        toolCalls: event.toolCalls,
        ...(event.display ? { display: event.display } : {}),
        ...(event.providerData === undefined ? {} : { providerData: event.providerData }),
        ...(event.summary === undefined ? {} : { summary: event.summary }),
        ...(event.complete === undefined ? {} : { complete: event.complete }),
      };
    case "message.reset":
      return { type: "message.reset", sessionId, reason: event.reason };
    case "tool_call.progress":
      return {
        type: "tool_call.progress",
        sessionId,
        index: event.index,
        ...(event.name ? { name: event.name } : {}),
        ...(event.delta ? { delta: event.delta } : {}),
      };
    case "tool.output":
      return { ...event, sessionId };
    case "tool.started":
      return { type: "tool.started", sessionId, call: event.call };
    case "tool.finished":
      return {
        type: "tool.finished",
        sessionId,
        call: event.call,
        result: event.result,
      };
    case "memory.context":
    case "steer.applied":
    case "translation.failed":
    case "notice.applied":
    case "model.fallback":
    case "provider.retry":
    case "context.compacted":
    case "context.usage":
      return { ...event, sessionId };
    case "usage":
      return { ...event, sessionId };
    case "hook.finished":
      return { type: "hook.finished", sessionId, hook: event.hook };
    case "turn.finished":
      return {
        type: "turn.finished",
        sessionId,
        turn: event.turn,
        reason: event.reason,
      };
  }
}
