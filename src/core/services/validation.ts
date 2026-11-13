import { z } from "zod";
import type { ModelEvent } from "../../providers/types";
import { abortable } from "../../util/abort";
import { toolResultSchema } from "../types/event-schema";

const usage = {
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cached: z.number().nonnegative(),
  reasoning: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
};
const toolCall = z.looseObject({ id: z.string(), name: z.string().min(1), args: z.unknown() });
export const ServiceMessageSchema = z.discriminatedUnion("role", [
  z.looseObject({ role: z.literal("user"), content: z.string() }),
  z.looseObject({
    role: z.literal("assistant"),
    content: z.string(),
    reasoning: z.string(),
    toolCalls: z.array(toolCall),
  }),
  z.looseObject({
    role: z.literal("tool"),
    content: z.string(),
    name: z.string(),
    toolCallId: z.string(),
    isError: z.boolean().optional(),
  }),
]);
export const ServiceToolResultSchema = toolResultSchema;
export const ServiceLoopResultSchema = z.looseObject({
  stopReason: z.enum(["done", "end", "stopped", "max_turns", "budget"]),
  summary: z.string(),
  lastText: z.string(),
  turns: z.number().int().nonnegative(),
  usage: z.object(usage),
  messages: z.array(ServiceMessageSchema),
  done: z.object({ summary: z.string(), evidence: z.array(z.string()) }).optional(),
});
const modelEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("reasoning"), delta: z.string() }),
  z.object({
    type: z.literal("tool_call"),
    id: z.string(),
    name: z.string().min(1),
    args: z.unknown(),
    extraContent: z.unknown().optional(),
  }),
  z.object({ type: z.literal("provider_data"), data: z.unknown() }),
  z.object({
    type: z.literal("tool_call_progress"),
    index: z.number().int().nonnegative(),
    name: z.string().optional(),
    delta: z.string().optional(),
  }),
  z.object({ type: z.literal("usage"), ...usage }),
  z.object({
    type: z.literal("route"),
    provider: z.string(),
    model: z.string(),
    reason: z.string(),
  }),
  z.object({ type: z.literal("done"), reason: z.enum(["end", "tool_use", "max_tokens"]) }),
]);
export async function* checkedModelEvents(
  source: AsyncIterable<ModelEvent>,
  signal: AbortSignal,
): AsyncIterable<ModelEvent> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (true) {
      signal.throwIfAborted();
      const item = await abortable(iterator.next(), signal);
      if (item.done) return;
      modelEvent.parse(item.value);
      yield item.value;
    }
  } finally {
    const closing = iterator.return?.();
    if (signal.aborted) void closing?.catch(() => undefined);
    else await closing;
  }
}
export function freezeValue<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeValue(child);
  }
  return value;
}
