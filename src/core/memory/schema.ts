import { z } from "zod";
import { type DictionaryEntry, DictionaryEntrySchema } from "../../../shared/dictionary";

export const MEMORY_ACTIVE_LIMIT = 500;
export const MEMORY_RECORD_LIMIT = 5_000;
export const MEMORY_HISTORY_LIMIT = 5_000;
export const MEMORY_FILE_BYTES = 32 * 1024 * 1024;

const text = (limit: number) =>
  z
    .string()
    .min(1)
    .max(limit)
    .refine((value) => value.trim().length > 0);
const timestamp = z.iso.datetime({ offset: true });
export const memoryKeySchema = text(160).regex(/^[a-z0-9][a-z0-9._/-]*$/);

export const memoryKindSchema = text(64).regex(/^[a-z][a-z0-9_-]*$/);

export const memoryEvidenceSchema = z
  .object({
    sessionId: text(256),
    role: z.enum(["user", "tool", "legacy"]),
    quote: text(4_000),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    reference: text(512),
  })
  .strict();

const fields = {
  key: memoryKeySchema,
  kind: memoryKindSchema,
  summary: text(300),
  content: text(8_000),
  reason: text(2_000),
  cues: z.array(text(160)).max(16),
  topics: z.array(text(64)).max(3).optional(),
  appliesWhen: text(300).optional(),
  dictionary: DictionaryEntrySchema.optional(),
  priority: z.enum(["normal", "critical"]),
  sources: z.array(memoryEvidenceSchema).min(1).max(12),
  expiresAt: timestamp.optional(),
};

function hasPreferenceEvidence(value: { kind: string; sources: { role: string }[] }): boolean {
  return (
    (value.kind !== "preference" && value.kind !== "lesson") ||
    value.sources.some((source) => source.role === "user")
  );
}

function hasDictionaryIdentity(value: {
  key: string;
  kind: string;
  dictionary?: DictionaryEntry | undefined;
}): boolean {
  return (
    !value.dictionary ||
    (value.kind === "vocabulary" && value.key === `dictionary/${value.dictionary.id}`)
  );
}

export const memoryWriteSchema = z
  .object({ ...fields, expectedRevision: z.number().int().min(0).optional() })
  .strict()
  .refine(
    hasDictionaryIdentity,
    "dictionary records require kind vocabulary and key dictionary/<id>",
  )
  .refine(hasPreferenceEvidence, "preferences and lessons require user evidence")
  .refine((value) => value.sources.every((source) => source.role !== "legacy"), {
    message: "legacy evidence is only accepted during migration",
  });

export const memoryRecordSchema = z
  .object({
    ...fields,
    id: text(256),
    revision: z.number().int().min(1),
    status: z.enum(["active", "forgotten"]),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
  .refine(
    hasDictionaryIdentity,
    "dictionary records require kind vocabulary and key dictionary/<id>",
  )
  .refine(hasPreferenceEvidence, "preferences and lessons require user evidence");

export const memoryFileSchema = z
  .object({
    version: z.literal(2),
    records: z.array(memoryRecordSchema).max(MEMORY_RECORD_LIMIT),
    history: z.array(memoryRecordSchema).max(MEMORY_HISTORY_LIMIT),
  })
  .strict()
  .refine(
    (value) =>
      value.records.filter((record) => record.status === "active").length <= MEMORY_ACTIVE_LIMIT,
    {
      message: "active memory limit exceeded",
    },
  )
  .refine(
    (value) => new Set(value.records.map((record) => record.id)).size === value.records.length,
    {
      message: "duplicate memory ids",
    },
  )
  .refine(
    (value) => new Set(value.records.map((record) => record.key)).size === value.records.length,
    {
      message: "duplicate memory keys",
    },
  );

export const legacyMemoryFileSchema = z
  .object({
    version: z.literal(1),
    records: z
      .array(
        z
          .object({
            id: text(256),
            text: text(8_000),
            kind: z.enum(["preference", "vocabulary", "taste", "anti_pattern", "decision", "fact"]),
            source: z
              .object({
                sessionId: text(256),
                messageId: text(512).optional(),
                path: text(512).optional(),
              })
              .strict(),
            weight: z.number().min(0).max(1),
            createdAt: timestamp,
            updatedAt: timestamp,
            tags: z.array(text(160)).max(16),
          })
          .strict(),
      )
      .max(MEMORY_ACTIVE_LIMIT),
  })
  .strict();

export type MemoryFile = z.infer<typeof memoryFileSchema>;
