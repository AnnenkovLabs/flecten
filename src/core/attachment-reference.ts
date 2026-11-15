import { z } from "zod";
import { HistoryAttachmentKindSchema } from "../../shared/message-branches";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_FILES = 5;

/** Durable metadata only; the binary payload stays in the session's artifact directory. */
export const AttachmentReferenceSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  mediaType: z.enum([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
    "application/pdf",
    "audio/mpeg",
    "audio/wav",
    "audio/flac",
    "audio/ogg",
    "audio/mp4",
    "audio/aac",
    "audio/webm",
  ]),
  bytes: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  name: z.string().min(1).max(255).optional(),
  estimatedTokens: z.number().int().positive().optional(),
});
export const AttachmentReferencesSchema = z
  .array(AttachmentReferenceSchema)
  .max(MAX_ATTACHMENT_FILES);
export type AttachmentReference = z.infer<typeof AttachmentReferenceSchema>;

export const AttachmentEntrySchema = z.object({
  name: z.string().min(1).max(512),
  kind: HistoryAttachmentKindSchema,
  size: z.number().int().nonnegative(),
  mediaIndexes: z.array(z.number().int().nonnegative()).max(MAX_ATTACHMENT_FILES),
  blockIndexes: z.array(z.number().int().nonnegative()).max(100),
});
export type AttachmentEntry = z.infer<typeof AttachmentEntrySchema>;

export const AttachmentSnapshotSchema = z
  .object({
    media: AttachmentReferencesSchema,
    blocks: z.array(z.string().max(250_000)).max(100),
    entries: z.array(AttachmentEntrySchema).max(100).optional(),
  })
  .refine(
    (snapshot) =>
      snapshot.entries?.every(
        (entry) =>
          entry.mediaIndexes.every((index) => index < snapshot.media.length) &&
          entry.blockIndexes.every((index) => index < snapshot.blocks.length),
      ) ?? true,
    "Invalid saved attachment indexes",
  );
export type AttachmentSnapshot = z.infer<typeof AttachmentSnapshotSchema>;
