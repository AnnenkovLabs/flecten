import { z } from "zod";

export const TwinSourceIdSchema = z.enum([
  "claude",
  "codex",
  "cursor",
  "omp",
  "kilo",
  "deepseek",
  "opencode",
  "hermes",
  "liquid",
]);
export type TwinSourceId = z.infer<typeof TwinSourceIdSchema>;
const text = (max: number) => z.string().min(1).max(max);
export const TwinReactionSchema = z.enum(["anger", "like", "delight"]);
export const TwinEmotionSchema = z.enum(["calm", "pleased", "angry", "furious"]);
export const TwinEvidenceSchema = z
  .object({
    sourceId: TwinSourceIdSchema,
    sessionId: text(256),
    reference: text(1024),
    quote: text(4000),
    digest: text(64),
    precedingAssistant: z.string().max(4000).optional(),
  })
  .strict();
export const TwinCandidateSchema = z
  .object({
    id: text(100),
    kind: z.enum(["preference", "lesson", "decision"]),
    reaction: TwinReactionSchema.default("like"),
    strength: z.number().int().min(1).max(3).default(2),
    voice: z.string().max(600).default(""),
    summary: text(300),
    content: text(2000),
    appliesWhen: text(300),
    evidence: z.array(TwinEvidenceSchema).min(1).max(4),
  })
  .strict();
export type TwinCandidate = z.infer<typeof TwinCandidateSchema>;
export const TwinEntrySchema = TwinCandidateSchema.extend({
  revision: z.number().int().min(1),
  updatedAt: text(64),
});
export const TwinSourceSchema = z.object({
  id: TwinSourceIdSchema,
  name: text(100),
  path: text(1024),
  available: z.boolean(),
  sessions: z.number().int().min(0),
  selected: z.boolean(),
  status: z.enum(["not-scanned", "ready", "missing", "unsupported", "limited", "error"]),
  warnings: z.array(text(1000)),
});
export type TwinSource = z.infer<typeof TwinSourceSchema>;
export const TwinUsageSchema = z.object({
  input: z.number().min(0),
  output: z.number().min(0),
  cached: z.number().min(0),
  costUsd: z.number().min(0).optional(),
});
export const TwinSnapshotSchema = z.object({
  enabled: z.boolean(),
  sources: z.array(TwinSourceSchema),
  candidates: z.array(TwinCandidateSchema),
  entries: z.array(TwinEntrySchema),
  training: z.object({
    state: z.enum(["idle", "reading", "learning", "ready", "cancelled", "error"]),
    message: z.string().max(2000),
    sessions: z.number().int().min(0),
    messages: z.number().int().min(0),
    usage: TwinUsageSchema,
    provider: z.string(),
    model: z.string(),
    samples: z
      .array(
        z
          .object({
            sourceId: TwinSourceIdSchema,
            sessionId: text(256),
            quote: text(4000),
          })
          .strict(),
      )
      .max(16)
      .optional(),
  }),
  limits: z.object({
    maxSessions: z.number().int(),
    maxMessages: z.number().int(),
    maxInputCharacters: z.number().int(),
    maxCandidates: z.number().int(),
    maxProfileEntries: z.number().int(),
  }),
});
export type TwinSnapshot = z.infer<typeof TwinSnapshotSchema>;
export const TwinTrainSchema = z.object({ sourceIds: z.array(TwinSourceIdSchema).min(1).max(9) });
export const TwinConfigureSchema = z.object({
  enabled: z.boolean().optional(),
  sourceIds: z.array(TwinSourceIdSchema).max(9).optional(),
});
export const TwinReviewSchema = z.object({
  candidateId: text(100),
  action: z.enum(["accept", "reject"]),
  edits: z
    .object({
      summary: text(300),
      content: text(2000),
      appliesWhen: text(300),
      reaction: TwinReactionSchema.optional(),
      strength: z.number().int().min(1).max(3).optional(),
      voice: text(600).optional(),
    })
    .optional(),
});
export const TwinForgetSchema = z.object({
  id: text(256),
  expectedRevision: z.number().int().min(1),
});
export const TwinConsultSchema = z.object({ question: text(2000) });
export const TwinAnswerSchema = z
  .object({
    answer: z.string().max(3000),
    abstained: z.boolean(),
    entryIds: z.array(text(256)).max(8),
    usage: TwinUsageSchema,
  })
  .strict();
export type TwinAnswer = z.infer<typeof TwinAnswerSchema>;
export const TwinTeachSchema = z.object({
  summary: text(300),
  content: text(2000),
  appliesWhen: text(300),
  path: text(1024).optional(),
  before: z.string().max(2000).optional(),
  after: z.string().max(2000).optional(),
  reaction: TwinReactionSchema.optional(),
  strength: z.number().int().min(1).max(3).optional(),
  voice: z.string().max(600).optional(),
});

export const TwinImageSchema = z.object({
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]),
  data: z.string().min(1).max(2_796_204).base64(),
  name: z.string().max(255).optional(),
});

export const TwinDelegateInputSchema = z
  .object({
    phase: z.enum(["prepare", "checkpoint", "final", "question"]),
    userMessages: z.array(z.string().max(16000)).max(16),
    task: z.string().max(16000),
    directive: z.string().max(16000),
    result: z.string().max(24000).optional(),
    evidence: z.array(z.string().max(4000)).max(12),
    question: z.string().max(2000).optional(),
    images: z.array(TwinImageSchema).max(2).optional(),
  })
  .strict();
export type TwinDelegateInput = z.infer<typeof TwinDelegateInputSchema>;
export const TwinDecisionSchema = z
  .object({
    verdict: z.enum(["pass", "revise", "ask_user"]),
    voice: z.string().max(3000),
    instructions: z.string().max(6000),
    entryIds: z.array(text(256)).max(8),
    emotion: TwinEmotionSchema,
    usage: TwinUsageSchema,
    provider: z.string(),
    model: z.string(),
  })
  .strict();
export type TwinDecision = z.infer<typeof TwinDecisionSchema>;
export const TwinUpdateSchema = z.object({
  id: text(256),
  expectedRevision: z.number().int().min(1),
  edits: z
    .object({
      summary: text(300),
      content: text(2000),
      appliesWhen: text(300),
      reaction: TwinReactionSchema,
      strength: z.number().int().min(1).max(3),
      voice: text(600),
    })
    .strict(),
});
