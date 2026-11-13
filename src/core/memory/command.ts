import { z } from "zod";
import { DictionaryEntrySchema } from "../../../shared/dictionary";
import { memoryKeySchema, memoryKindSchema } from "./schema";

export const MemoryCandidateSchema = z
  .object({
    key: memoryKeySchema,
    kind: memoryKindSchema,
    summary: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(1600),
    reason: z.string().trim().min(1).max(500),
    cues: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
    topics: z.array(z.string().trim().min(1).max(64)).max(3).optional(),
    appliesWhen: z.string().trim().min(1).max(300).optional(),
    dictionary: DictionaryEntrySchema.optional(),
    priority: z.enum(["normal", "critical"]),
    expiresAt: z.iso.datetime().optional(),
    expectedRevision: z.number().int().nonnegative(),
    evidence: z
      .array(
        z
          .object({
            role: z.enum(["user", "tool"]),
            quote: z.string().min(8).max(1200),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();

export const MemoryCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({ operation: z.literal("topics"), cursor: z.number().int().nonnegative().optional() })
    .strict(),
  z
    .object({
      operation: z.literal("list"),
      kind: memoryKindSchema.optional(),
      topic: z.string().min(1).max(64).optional(),
      query: z.string().max(160).optional(),
      cursor: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("read"),
      id: z.string().min(1).max(160).optional(),
      ids: z.array(z.string().min(1).max(160)).min(1).max(6).optional(),
    })
    .strict()
    .refine((value) => Boolean(value.id) !== Boolean(value.ids), "Choose id or ids"),
  z.object({ operation: z.literal("sources") }).strict(),
  MemoryCandidateSchema.extend({ operation: z.literal("save") }),
  z
    .object({
      operation: z.literal("reconcile"),
      save: z.array(MemoryCandidateSchema).max(8).default([]),
      forget: z
        .array(
          z
            .object({
              id: z.string().min(1).max(160),
              expectedRevision: z.number().int().positive(),
            })
            .strict(),
        )
        .max(8)
        .default([]),
    })
    .strict()
    .refine(
      (value) => value.save.length + value.forget.length > 0,
      "Provide save or forget operations",
    ),
  z
    .object({
      operation: z.literal("forget"),
      id: z.string().min(1).max(160),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
]);

export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
export type MemoryCommand = z.infer<typeof MemoryCommandSchema>;

export interface MemoryReference {
  id: string;
  revision: number;
  level: "index" | "full" | "invalidated";
}

export const MemoryReferencesSchema = z
  .array(
    z
      .object({
        id: z.string().min(1),
        revision: z.number().int().positive(),
        level: z.enum(["index", "full", "invalidated"]),
      })
      .strict(),
  )
  .max(5024);

export interface MemoryDelivery {
  text: string;
  references: MemoryReference[];
}
