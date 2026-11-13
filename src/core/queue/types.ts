import { z } from "zod";
import { AttachmentSnapshotSchema } from "../attachment-reference";
import { ContextReferencesSchema } from "../context-reference";

export const AttachmentsSchema = z.array(z.string().min(1)).min(1);

export const QueueItemModeSchema = z.enum(["queue", "steer"]);
export const QueueItemStateSchema = z.enum(["pending", "sending", "sent", "cancelled"]);

export const QueueItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  mode: QueueItemModeSchema,
  createdAt: z.number().int().nonnegative(),
  attachments: AttachmentsSchema.optional(),
  attachmentSnapshot: AttachmentSnapshotSchema.optional(),
  contexts: ContextReferencesSchema.optional(),
  state: QueueItemStateSchema,
});

export type QueueItemMode = z.infer<typeof QueueItemModeSchema>;
export type QueueItemState = z.infer<typeof QueueItemStateSchema>;
export type QueueItem = z.infer<typeof QueueItemSchema>;

export const SerializedQueueSchema = z
  .object({
    version: z.literal(1),
    items: z.array(QueueItemSchema),
  })
  .refine((queue) => new Set(queue.items.map((item) => item.id)).size === queue.items.length, {
    message: "queue item ids must be unique",
  });

export type SerializedQueue = z.infer<typeof SerializedQueueSchema>;
