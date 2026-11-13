import { z } from "zod";
import type { TwinSourceId } from "../../shared/twin";

const block = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const content = z.union([z.string(), z.array(block)]);
const message = z.object({ role: z.string(), content }).passthrough();
const codex = z.object({
  type: z.literal("response_item"),
  payload: z.object({
    type: z.literal("message"),
    role: z.literal("user"),
    content: z.array(block),
  }),
});
const claude = z.object({
  type: z.literal("user"),
  message,
  isMeta: z.boolean().optional(),
  isSidechain: z.boolean().optional(),
});
const pi = z.object({ type: z.literal("message"), message });
const liquid = z.object({
  event: z.object({
    type: z.literal("session.started"),
    prompt: z.string(),
    internal: z.boolean().optional(),
    resumed: z.boolean().optional(),
    role: z.string().optional(),
  }),
});
const liquidEvent = liquid.shape.event;

function plain(value: z.infer<typeof content>, types = ["text"]): string[] {
  return typeof value === "string"
    ? [value]
    : value.flatMap((part) => (types.includes(part.type) && part.text ? [part.text] : []));
}

/** Roles come from each producer's stored schema; tool results and assistant prose are excluded. */
export function userWords(id: TwinSourceId, value: unknown): string[] {
  if (id === "codex") {
    const parsed = codex.safeParse(value);
    return parsed.success ? plain(parsed.data.payload.content, ["input_text"]) : [];
  }
  if (id === "claude") {
    const parsed = claude.safeParse(value);
    return parsed.success &&
      !parsed.data.isMeta &&
      !parsed.data.isSidechain &&
      parsed.data.message.role === "user"
      ? plain(parsed.data.message.content)
      : [];
  }
  if (id === "omp") {
    const parsed = pi.safeParse(value);
    return parsed.success && parsed.data.message.role === "user"
      ? plain(parsed.data.message.content)
      : [];
  }
  if (id === "liquid") {
    const nested = liquid.safeParse(value);
    const parsed = nested.success
      ? { success: true as const, data: nested.data.event }
      : liquidEvent.safeParse(value);
    return parsed.success &&
      !parsed.data.internal &&
      !parsed.data.resumed &&
      parsed.data.role !== "worker"
      ? [parsed.data.prompt]
      : [];
  }
  if (["kilo", "deepseek", "cursor", "hermes"].includes(id)) {
    const parsed = message.safeParse(value);
    return parsed.success && parsed.data.role === "user" ? plain(parsed.data.content) : [];
  }
  return [];
}

export function jsonDocuments(value: unknown): unknown[] {
  const array = z.array(z.unknown()).safeParse(value);
  if (array.success) return array.data;
  const exported = z.object({ messages: z.array(z.unknown()) }).safeParse(value);
  return exported.success ? exported.data.messages : [value];
}

export const OpenCodePartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
});

/** Preceding assistant text supplies the object of a reaction, never authority for a trait. */
export function assistantWords(id: TwinSourceId, value: unknown): string[] {
  if (id === "liquid") {
    const schema = z.object({ type: z.literal("message.finished"), text: z.string() });
    const nested = z.object({ event: schema }).safeParse(value);
    const parsed = nested.success
      ? { success: true as const, data: nested.data.event }
      : schema.safeParse(value);
    return parsed.success ? [parsed.data.text] : [];
  }
  if (id === "codex") {
    const parsed = z
      .object({
        type: z.literal("response_item"),
        payload: z.object({
          type: z.literal("message"),
          role: z.literal("assistant"),
          content: z.array(block),
        }),
      })
      .safeParse(value);
    return parsed.success ? plain(parsed.data.payload.content, ["output_text"]) : [];
  }
  if (id === "claude" || id === "omp") {
    const parsed = z.object({ type: z.string(), message }).safeParse(value);
    return parsed.success && parsed.data.message.role === "assistant"
      ? plain(parsed.data.message.content)
      : [];
  }
  const parsed = message.safeParse(value);
  return parsed.success && parsed.data.role === "assistant" ? plain(parsed.data.content) : [];
}
