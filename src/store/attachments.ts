import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type AttachmentReference,
  AttachmentReferencesSchema,
  MAX_ATTACHMENT_BYTES,
} from "../core/attachment-reference";
import type { ImagePart, Message } from "../core/types";
import { atomicWrite } from "../util/atomic";
import { sessionPaths } from "./paths";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Save before the referencing event: a durable send never depends on the source path again. */
export async function saveSessionMedia(
  cwd: string,
  sessionId: string,
  parts: readonly ImagePart[],
): Promise<AttachmentReference[]> {
  const prepared = parts.map((part) => {
    if (part.data.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4)
      throw new Error("Attachment exceeds the 10 MiB limit.");
    const bytes = Buffer.from(part.data, "base64");
    if (bytes.toString("base64") !== part.data)
      throw new Error("Attachment payload is not valid base64.");
    return {
      bytes,
      ref: {
        id: digest(bytes),
        mediaType: part.mediaType,
        bytes: bytes.length,
        ...(part.name ? { name: part.name } : {}),
        ...(part.estimatedTokens ? { estimatedTokens: part.estimatedTokens } : {}),
      },
    };
  });
  const refs = AttachmentReferencesSchema.parse(prepared.map(({ ref }) => ref));
  for (const { bytes, ref } of prepared) {
    const path = join(sessionPaths(cwd, sessionId).attachments, `${ref.id}.bin`);
    await atomicWrite(path, bytes, 0o600);
    const file = await open(path, "r");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  }
  if (refs.length > 0 && process.platform !== "win32") {
    const directory = await open(sessionPaths(cwd, sessionId).attachments, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  return refs;
}

export async function loadSessionMedia(
  cwd: string,
  sessionId: string,
  values: readonly AttachmentReference[],
): Promise<ImagePart[]> {
  const refs = AttachmentReferencesSchema.parse(values);
  return Promise.all(
    refs.map(async (ref) => {
      try {
        const path = join(sessionPaths(cwd, sessionId).attachments, `${ref.id}.bin`);
        const info = await stat(path);
        if (!info.isFile() || info.size !== ref.bytes) throw new Error("saved size does not match");
        const bytes = Buffer.from(
          await Bun.file(path)
            .slice(0, MAX_ATTACHMENT_BYTES + 1)
            .arrayBuffer(),
        );
        if (digest(bytes) !== ref.id) throw new Error("saved checksum does not match");
        return {
          mediaType: ref.mediaType,
          path,
          data: bytes.toString("base64"),
          ...(ref.name ? { name: ref.name } : {}),
          ...(ref.estimatedTokens ? { estimatedTokens: ref.estimatedTokens } : {}),
        };
      } catch (error) {
        throw new Error(
          `Cannot restore attachment ${ref.name ?? ref.id}: ${error instanceof Error ? error.message : String(error)}. Reattach the original file before continuing.`,
          { cause: error },
        );
      }
    }),
  );
}

/** Hydrate only the retained messages, after replay has applied every compaction. */
export async function restoreSessionMedia(
  cwd: string,
  sessionId: string,
  messages: Message[],
): Promise<Message[]> {
  return Promise.all(
    messages.map(async (message) => {
      if (message.role !== "user" || !message.attachmentRefs) return message;
      const { attachmentRefs, ...text } = message;
      return { ...text, images: await loadSessionMedia(cwd, sessionId, attachmentRefs) };
    }),
  );
}
