import { z } from "zod";

const text = (limit: number) => z.string().trim().min(1).max(limit);
const identifier = text(80).refine(
  (value) =>
    "abcdefghijklmnopqrstuvwxyz0123456789".includes(value[0] ?? "") &&
    [...value].every((char) => "abcdefghijklmnopqrstuvwxyz0123456789-".includes(char)),
  "Use lowercase letters, numbers and hyphens",
);

export const DictionaryEntrySchema = z
  .object({
    id: identifier,
    term: text(160),
    aliases: z.array(text(160)).max(24).default([]),
    definition: text(4_000),
    category: identifier,
    clarification: text(2_000).optional(),
    sources: z
      .array(
        z
          .url()
          .max(2_048)
          .refine((value) => new URL(value).protocol === "https:"),
      )
      .max(8)
      .default([]),
  })
  .strict();

export const DictionaryRecordSchema = DictionaryEntrySchema.extend({
  source: z.enum(["public", "local"]),
  revision: z.number().int().min(1).optional(),
});

export const DictionaryWriteSchema = z
  .object({
    entry: DictionaryEntrySchema,
    expectedRevision: z.number().int().min(0).optional(),
  })
  .strict();

export const DictionaryDeleteSchema = z
  .object({
    id: identifier,
    expectedRevision: z.number().int().min(1),
  })
  .strict();

export const DictionaryCategorySchema = z
  .object({
    schemaVersion: z.literal(1),
    category: identifier,
    entries: z.array(DictionaryEntrySchema).max(2_000),
  })
  .strict()
  .refine((value) => value.entries.every((entry) => entry.category === value.category), {
    message: "Every entry must belong to the declared category",
  })
  .refine(
    (value) => new Set(value.entries.map((entry) => entry.id)).size === value.entries.length,
    {
      message: "Duplicate dictionary entry id",
    },
  );

export const DictionaryIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    categories: z
      .array(
        text(100).refine((value) => {
          if (value.length <= 5 || !value.endsWith(".json")) return false;
          return [...value.slice(0, -5)].every((char) =>
            "abcdefghijklmnopqrstuvwxyz0123456789-".includes(char),
          );
        }, "Expected a category JSON filename"),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .refine((value) => new Set(value.categories).size === value.categories.length, {
    message: "Duplicate dictionary category filename",
  });

export const DictionarySnapshotSchema = z
  .object({
    entries: z.array(DictionaryRecordSchema).max(5_500),
    publicSource: z.url(),
    syncedAt: z.iso.datetime().optional(),
    error: z.string().max(2_000).optional(),
  })
  .strict();

export type DictionaryEntry = z.infer<typeof DictionaryEntrySchema>;
export type DictionaryRecord = z.infer<typeof DictionaryRecordSchema>;
export type DictionaryWrite = z.infer<typeof DictionaryWriteSchema>;
export type DictionarySnapshot = z.infer<typeof DictionarySnapshotSchema>;
export type DictionaryCategory = z.infer<typeof DictionaryCategorySchema>;
export interface DictionaryMatch {
  entry: DictionaryRecord;
  matchedAlias: string;
}
