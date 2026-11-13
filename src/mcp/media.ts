import { z } from "zod";
import {
  AttachmentReferenceSchema,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES,
} from "../core/attachment-reference";
import { estimateMedia } from "../core/media";
import type { ImagePart } from "../core/types";
import { isObject } from "../util/json";

const Media = z
  .object({
    type: z.enum(["image", "audio"]),
    mimeType: AttachmentReferenceSchema.shape.mediaType,
    data: z
      .string()
      .min(1)
      .max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4),
  })
  .refine(
    (value) => value.mimeType.startsWith(`${value.type}/`),
    "MCP media type does not match its MIME type",
  );

/** Binary payloads are validated and stored separately; they never enter JSONL or text logs. */
export function mcpMedia(content: unknown): ImagePart[] {
  if (!Array.isArray(content)) return [];
  const blocks = content.filter(
    (block) => isObject(block) && (block.type === "image" || block.type === "audio"),
  );
  if (blocks.length > MAX_ATTACHMENT_FILES)
    throw new Error(`MCP returned more than ${MAX_ATTACHMENT_FILES} media attachments`);
  return blocks.map((block) => {
    const media = Media.parse(block);
    const bytes = Buffer.from(media.data, "base64");
    if (bytes.length > MAX_ATTACHMENT_BYTES || bytes.toString("base64") !== media.data)
      throw new Error("MCP media is oversized or has invalid base64");
    return {
      mediaType: media.mimeType,
      data: media.data,
      estimatedTokens: estimateMedia(bytes, media.mimeType),
    };
  });
}
