import { z } from "zod";

export const HistoryAttachmentKindSchema = z.enum([
  "audio",
  "image",
  "pdf",
  "text",
  "folder",
  "file",
]);
export const HistoryAttachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(512),
  kind: HistoryAttachmentKindSchema,
  size: z.number().int().nonnegative(),
});
export type HistoryAttachment = z.infer<typeof HistoryAttachmentSchema>;

export const MessageVersionSchema = z.object({
  messageId: z.string().min(1),
  current: z.number().int().positive(),
  variants: z.array(z.string().min(1)).min(1),
  attachments: z.array(HistoryAttachmentSchema).optional(),
});
export type MessageVersion = z.infer<typeof MessageVersionSchema>;

export const HistoryEditedSchema = z.object({
  type: z.literal("history.edited"),
  sessionId: z.string(),
  branchId: z.string().min(1),
  parentBranchId: z.string().min(1),
  messageId: z.string().min(1),
  targetSequence: z.number().int().positive(),
});
export const HistorySelectedSchema = z.object({
  type: z.literal("history.selected"),
  sessionId: z.string(),
  branchId: z.string().min(1),
});
export type HistoryEdited = z.infer<typeof HistoryEditedSchema>;
export type HistorySelected = z.infer<typeof HistorySelectedSchema>;
