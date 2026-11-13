import { z } from "zod";
import { HookRunSchema } from "../../../shared/hooks";
import { ModuleReferencesSchema } from "../../../shared/modules";
import { SessionStateSchema } from "../../../shared/session-state";
import { SubagentInfoSchema, SubagentResultSchema } from "../../../shared/subagents";
import { TwinActivitySchema } from "../../../shared/twin-activity";
import { AttachmentReferencesSchema } from "../attachment-reference";
import { MemoryReferencesSchema } from "../memory/command";
import { ContextSummarySchema } from "../pages/summary";
import { REASONING_EFFORTS } from "./index";

const usageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cached: z.number(),
  reasoning: z.number().optional(),
  cacheWrite: z.number().nonnegative().optional(),
});

const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.unknown(),
  extraContent: z.unknown().optional(),
});

export const toolResultSchema = z.object({
  attachments: AttachmentReferencesSchema.optional(),
  ok: z.boolean(),
  output: z.string(),
  error: z.string().optional(),
  fullOutputPath: z.string().optional(),
  provenance: z
    .object({ source: z.enum(["file", "web", "mcp", "shell"]), ref: z.string().optional() })
    .optional(),
  notice: z.string().optional(),
  trailer: z.string().optional(),
  durationMs: z.number().optional(),
  terminate: z.boolean().optional(),
  data: z.unknown().optional(),
});

const jobSchema = z.looseObject({
  id: z.string(),
  command: z.string(),
  status: z.string(),
  exitCode: z.number().nullable(),
  durationMs: z.number(),
});

const resultSchema = z.object({
  sessionId: z.string(),
  pass: z.boolean(),
  stopReason: z.enum(["done", "end", "stopped", "error", "max_turns", "budget"]),
  summary: z.string(),
  turns: z.number(),
  usage: usageSchema,
  budget: z.unknown().optional(),
});

const sessionEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("twin.activity"),
    sessionId: z.string(),
    activity: TwinActivitySchema,
  }),
  z.object({
    type: z.literal("provider.retry"),
    sessionId: z.string(),
    kind: z.enum([
      "rate_limit",
      "quota_5h",
      "quota_weekly",
      "billing",
      "network",
      "server",
      "auth",
      "context",
      "bad_request",
      "unknown",
    ]),
    attempt: z.number().int().nonnegative(),
    delayMs: z.number().nonnegative(),
    until: z.number(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("tool.output"),
    sessionId: z.string(),
    callId: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("input.translated"),
    sessionId: z.string(),
    input: z.string(),
    language: z.string(),
    system: z.unknown().optional(),
  }),
  z.object({ type: z.literal("translation.failed"), sessionId: z.string(), message: z.string() }),
  z.object({ type: z.literal("session.state"), sessionId: z.string(), state: SessionStateSchema }),
  z.object({
    type: z.literal("session.started"),
    role: z.enum(["talker", "worker"]).optional(),
    sessionId: z.string(),
    provider: z.string(),
    model: z.string(),
    prompt: z.string(),
    input: z.string().optional(),
    attachments: AttachmentReferencesSchema.optional(),
    reasoning: z.enum(REASONING_EFFORTS).optional(),
    system: z.unknown().optional(),
    queueId: z.string().optional(),
    resumed: z.boolean().optional(),
    internal: z.boolean().optional(),
    budget: z.unknown().optional(),
  }),
  z.object({ type: z.literal("turn.started"), sessionId: z.string(), turn: z.number() }),
  z.object({ type: z.literal("message.started"), sessionId: z.string() }),
  z.object({ type: z.literal("message.delta"), sessionId: z.string(), text: z.string() }),
  z.object({ type: z.literal("reasoning.delta"), sessionId: z.string(), text: z.string() }),
  z.object({
    type: z.literal("message.finished"),
    sessionId: z.string(),
    text: z.string(),
    reasoning: z.string(),
    toolCalls: z.array(toolCallSchema),
    providerData: z.unknown().optional(),
    summary: z.string().optional(),
    complete: z.boolean().optional(),
    display: z
      .object({ text: z.string(), reasoning: z.string(), summary: z.string().optional() })
      .optional(),
  }),
  z.object({
    type: z.literal("tool_call.progress"),
    sessionId: z.string(),
    index: z.number(),
    name: z.string().optional(),
    delta: z.string().optional(),
  }),
  z.object({ type: z.literal("tool.started"), sessionId: z.string(), call: toolCallSchema }),
  z.object({
    type: z.literal("tool.finished"),
    sessionId: z.string(),
    call: toolCallSchema,
    result: toolResultSchema,
  }),
  z.object({ type: z.literal("message.reset"), sessionId: z.string(), reason: z.string() }),
  z.object({
    type: z.literal("steer.applied"),
    sessionId: z.string(),
    text: z.string(),
    input: z.string().optional(),
    attachments: AttachmentReferencesSchema.optional(),
    queueId: z.string().optional(),
  }),
  z.object({
    type: z.literal("memory.context"),
    sessionId: z.string(),
    text: z.string(),
    references: MemoryReferencesSchema,
  }),
  z.object({
    type: z.literal("notice.applied"),
    sessionId: z.string(),
    text: z.string(),
    moduleReferences: ModuleReferencesSchema.optional(),
    attachments: AttachmentReferencesSchema.optional(),
  }),
  z.object({ type: z.literal("job.started"), sessionId: z.string(), job: jobSchema }),
  z.object({
    type: z.literal("job.finished"),
    sessionId: z.string(),
    job: jobSchema,
    notify: z.boolean(),
    checkpoint: z.unknown().optional(),
  }),
  z.object({ type: z.literal("budget"), sessionId: z.string(), budget: z.unknown() }),
  z.object({
    type: z.literal("run.interrupted"),
    sessionId: z.string(),
    at: z.number(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("approval.requested"),
    sessionId: z.string(),
    approval: z.looseObject({ id: z.string(), tool: z.string(), expiresAt: z.number() }),
  }),
  z.object({
    type: z.literal("approval.resolved"),
    sessionId: z.string(),
    id: z.string(),
    choice: z.enum(["allow_once", "allow_session", "allow_always", "deny"]),
    by: z.enum(["user", "timeout", "aborted", "policy", "persistence"]),
    feedback: z.string().optional(),
  }),
  z.object({
    type: z.literal("context.compacted"),
    sessionId: z.string(),
    summary: z.string(),
    displaySummary: z.string().optional(),
    contextSummary: ContextSummarySchema.optional(),
    pruned: z.number().int().nonnegative(),
    before: z.number().optional(),
    after: z.number().optional(),
    kept: z.number().optional(),
    page: z.number().optional(),
    path: z.string().optional(),
    source: z.enum(["model", "deterministic"]).optional(),
    focus: z.string().optional(),
  }),
  z.object({
    type: z.literal("context.usage"),
    sessionId: z.string(),
    used: z.number(),
    window: z.number(),
    reserve: z.number(),
    source: z.enum(["estimate", "provider"]),
  }),
  z.object({
    type: z.literal("model.fallback"),
    sessionId: z.string(),
    provider: z.string(),
    model: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("usage"),
    sessionId: z.string(),
    usage: usageSchema,
    purpose: z.enum(["translation", "vision"]).optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal("hook.finished"),
    sessionId: z.string(),
    hook: HookRunSchema,
  }),
  z.object({
    type: z.literal("turn.finished"),
    sessionId: z.string(),
    turn: z.number(),
    reason: z.string(),
  }),
  z.object({ type: z.literal("session.finished"), sessionId: z.string(), result: resultSchema }),
  z.object({
    type: z.literal("error"),
    sessionId: z.string().optional(),
    code: z.string(),
    message: z.string(),
    limit: z.enum(["rate", "five_hour", "weekly", "billing"]).optional(),
    resetAt: z.number().optional(),
  }),
]);

/** Event types a stored log can give back; tests check it covers everything the sidecar writes. */
export type StoredEventType = z.infer<typeof eventSchema>["type"];

const childEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subagent.started"),
    sessionId: z.string(),
    subagent: SubagentInfoSchema,
  }),
  z.object({
    type: z.literal("subagent.event"),
    sessionId: z.string(),
    id: z.string(),
    event: sessionEventSchema,
  }),
  z.object({
    type: z.literal("subagent.finished"),
    sessionId: z.string(),
    id: z.string(),
    result: SubagentResultSchema,
    cancelled: z.boolean(),
  }),
]);
export const eventSchema = z.union([
  sessionEventSchema,
  childEventSchema,
  z.object({
    type: z.literal("worker.event"),
    sessionId: z.string(),
    event: z.union([sessionEventSchema, childEventSchema]),
  }),
]);
