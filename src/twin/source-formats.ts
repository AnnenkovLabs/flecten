import { z } from "zod";
import type { TwinSourceId } from "../../shared/twin";

const block = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const content = z.union([z.string(), z.array(block)]);
const message = z
  .object({
    role: z.string(),
    content,
    synthetic: z.boolean().optional(),
    ignored: z.boolean().optional(),
    internal: z.boolean().optional(),
  })
  .passthrough();
const codexMetadata = z
  .object({
    content_item_kinds: z.array(z.string()).optional(),
    content_item_metadata: z
      .array(
        z
          .object({
            provenance: z.object({ type: z.string() }).passthrough().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
const codex = z.object({
  type: z.literal("response_item"),
  payload: z.object({
    type: z.literal("message"),
    role: z.literal("user"),
    content: z.array(block),
    internal_chat_message_metadata_passthrough: codexMetadata.optional(),
  }),
});
const codexSessionMeta = z.object({
  type: z.literal("session_meta"),
  payload: z
    .object({
      source: z.unknown().optional(),
      thread_source: z.string().optional(),
      parent_thread_id: z.string().nullable().optional(),
      forked_from_id: z.string().nullable().optional(),
      agent_role: z.string().nullable().optional(),
      subagent_history_start_ordinal: z.number().optional(),
    })
    .passthrough(),
});
const claude = z.object({
  type: z.literal("user"),
  message,
  isMeta: z.boolean().optional(),
  isSidechain: z.boolean().optional(),
  agentId: z.string().nullable().optional(),
  userType: z.string().nullable().optional(),
  sourceToolAssistantUUID: z.string().nullable().optional(),
});
const pi = z.object({
  type: z.literal("message"),
  message,
  isMeta: z.boolean().optional(),
  synthetic: z.boolean().optional(),
});
const piSessionHeader = z.object({
  type: z.literal("session"),
  parentSession: z.string().nullable().optional(),
  subagent: z.unknown().optional(),
  internal: z.boolean().optional(),
});
const commandCode = z.object({
  type: z.literal("message"),
  message,
  isMeta: z.boolean().optional(),
  isSidechain: z.boolean().optional(),
  isAutomated: z.boolean().optional(),
  isSummary: z.boolean().optional(),
  agentId: z.string().nullable().optional(),
  meta: z
    .object({
      source: z.string().optional(),
      isAutomated: z.boolean().optional(),
      isMeta: z.boolean().optional(),
      isSummary: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
});
const flectenStarted = z.object({
  type: z.literal("session.started"),
  prompt: z.string(),
  internal: z.boolean().optional(),
  resumed: z.boolean().optional(),
  continuation: z.boolean().optional(),
  role: z.string().optional(),
  actor: z.string().optional(),
});
const flectenSteer = z.object({
  type: z.literal("steer.applied"),
  text: z.string(),
  actor: z.string().optional(),
});
const flectenEvent = z.union([flectenStarted, flectenSteer]);
const flecten = z.object({ event: flectenEvent });

function plain(value: z.infer<typeof content>, types = ["text"]): string[] {
  return typeof value === "string"
    ? [value]
    : value.flatMap((part) => (types.includes(part.type) && part.text ? [part.text] : []));
}

/** Detects whether a session header record marks the whole file as a subagent or service session. */
export function isAuxiliarySessionRecord(id: TwinSourceId, value: unknown): boolean {
  if (id === "codex") {
    const parsed = codexSessionMeta.safeParse(value);
    if (!parsed.success) return false;
    const {
      source,
      thread_source,
      parent_thread_id,
      forked_from_id,
      agent_role,
      subagent_history_start_ordinal,
    } = parsed.data.payload;
    if (
      thread_source === "subagent" ||
      parent_thread_id ||
      forked_from_id ||
      agent_role ||
      subagent_history_start_ordinal !== undefined
    )
      return true;
    if (typeof source === "object" && source !== null && "subagent" in source) return true;
    if (typeof source === "string" && source.includes('"subagent"')) return true;
    return false;
  }
  if (id === "omp") {
    const parsed = piSessionHeader.safeParse(value);
    if (!parsed.success) return false;
    return Boolean(
      parsed.data.parentSession || parsed.data.subagent || parsed.data.internal === true,
    );
  }
  if (id === "claude") {
    const parsed = claude.safeParse(value);
    return Boolean(parsed.success && (parsed.data.isSidechain || parsed.data.agentId));
  }
  if (id === "commandcode") {
    const parsed = commandCode.safeParse(value);
    return Boolean(parsed.success && (parsed.data.isSidechain || parsed.data.agentId));
  }
  return false;
}

/** Roles come from each producer's stored schema; tool results and assistant prose are excluded. */
export function userWords(id: TwinSourceId, value: unknown): string[] {
  if (id === "codex") {
    const parsed = codex.safeParse(value);
    if (!parsed.success) return [];
    const meta = parsed.data.payload.internal_chat_message_metadata_passthrough;
    if (meta) {
      const kinds = meta.content_item_kinds;
      const items = meta.content_item_metadata;
      if (kinds && !kinds.includes("user.text")) return [];
      if (items && items.length > 0 && !items.some((item) => item.provenance?.type === "user"))
        return [];
    }
    return plain(parsed.data.payload.content, ["input_text"]);
  }
  if (id === "claude") {
    const parsed = claude.safeParse(value);
    return parsed.success &&
      !parsed.data.isMeta &&
      !parsed.data.isSidechain &&
      !parsed.data.agentId &&
      !parsed.data.sourceToolAssistantUUID &&
      (parsed.data.userType === undefined ||
        parsed.data.userType === null ||
        parsed.data.userType === "external") &&
      !parsed.data.message.synthetic &&
      !parsed.data.message.ignored &&
      !parsed.data.message.internal &&
      parsed.data.message.role === "user"
      ? plain(parsed.data.message.content)
      : [];
  }
  if (id === "omp") {
    const parsed = pi.safeParse(value);
    return parsed.success &&
      !parsed.data.isMeta &&
      !parsed.data.synthetic &&
      !parsed.data.message.synthetic &&
      !parsed.data.message.ignored &&
      !parsed.data.message.internal &&
      parsed.data.message.role === "user"
      ? plain(parsed.data.message.content)
      : [];
  }
  if (id === "commandcode") {
    const parsed = commandCode.safeParse(value);
    if (!parsed.success) return [];
    const meta = parsed.data.meta;
    if (
      parsed.data.isMeta ||
      parsed.data.isSidechain ||
      parsed.data.isAutomated ||
      parsed.data.isSummary ||
      parsed.data.agentId ||
      meta?.isAutomated ||
      meta?.isMeta ||
      meta?.isSummary ||
      (meta?.source !== undefined && meta.source !== "user") ||
      parsed.data.message.synthetic ||
      parsed.data.message.ignored ||
      parsed.data.message.internal ||
      parsed.data.message.role !== "user"
    )
      return [];
    return plain(parsed.data.message.content);
  }
  if (id === "flecten") {
    const nested = flecten.safeParse(value);
    const parsed = nested.success
      ? { success: true as const, data: nested.data.event }
      : flectenEvent.safeParse(value);
    if (!parsed.success) return [];
    if (parsed.data.type === "steer.applied") {
      return parsed.data.actor !== "twin" ? [parsed.data.text] : [];
    }
    return !parsed.data.internal &&
      !parsed.data.resumed &&
      !parsed.data.continuation &&
      parsed.data.role !== "worker" &&
      parsed.data.actor !== "twin"
      ? [parsed.data.prompt]
      : [];
  }
  if (["kilo", "deepseek", "cursor", "hermes"].includes(id)) {
    const parsed = message.safeParse(value);
    return parsed.success &&
      !parsed.data.synthetic &&
      !parsed.data.ignored &&
      !parsed.data.internal &&
      parsed.data.role === "user"
      ? plain(parsed.data.content)
      : [];
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
  if (id === "flecten") {
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
  if (id === "claude" || id === "omp" || id === "commandcode") {
    const parsed = z.object({ type: z.string(), message }).safeParse(value);
    return parsed.success && parsed.data.message.role === "assistant"
      ? plain(parsed.data.message.content)
      : [];
  }
  const parsed = message.safeParse(value);
  return parsed.success && parsed.data.role === "assistant" ? plain(parsed.data.content) : [];
}
