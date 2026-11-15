import { markdownData } from "../../util/markdown";
import { type AttachmentSnapshot, AttachmentSnapshotSchema } from "../attachment-reference";
import { loadAttachments } from "../attachments";
import type { ImagePart, Message } from "../types";
import type { SessionOptions } from "./options";

function assertMedia(
  parts: readonly ImagePart[],
  modalities: readonly string[] | undefined,
  describeImages = false,
): void {
  for (const part of parts) {
    const modality = part.mediaType.startsWith("audio/")
      ? "audio"
      : part.mediaType === "application/pdf"
        ? "pdf"
        : "image";
    if (
      (describeImages && modality === "image") ||
      modalities?.includes(modality) ||
      (modality === "image" && (!modalities || modalities.length === 0))
    )
      continue;
    throw new Error(
      `The current model does not accept the saved ${modality} attachment ${part.name ?? part.mediaType}. Select a compatible model before continuing.`,
    );
  }
}

export function assertHistoryMedia(messages: readonly Message[], options: SessionOptions): void {
  for (const message of messages)
    if (message.role === "user")
      assertMedia(message.images ?? [], options.modalities, Boolean(options.vision));
}

export async function sessionAttachments(
  paths: readonly string[],
  sessionId: string,
  options: SessionOptions,
  snapshot?: AttachmentSnapshot,
  input: { strict?: boolean } = {},
) {
  if (snapshot) {
    const saved = AttachmentSnapshotSchema.parse(snapshot);
    if (!options.loadMedia && saved.media.length > 0)
      throw new Error("Saved attachments cannot be restored by this session.");
    const parts = (await options.loadMedia?.(sessionId, saved.media)) ?? [];
    assertMedia(parts, options.modalities, Boolean(options.vision));
    return {
      parts,
      blocks: saved.blocks,
      media: saved.media,
      snapshot: saved,
    };
  }
  const loaded = await loadAttachments(paths, {
    cwd: options.cwd,
    ...input,
    modalities: options.modalities,
    describeImages: Boolean(options.vision),
  });
  const media =
    loaded.parts.length > 0 ? ((await options.saveMedia?.(sessionId, loaded.parts)) ?? []) : [];
  const parts =
    media.length && options.loadMedia ? await options.loadMedia(sessionId, media) : loaded.parts;
  const blocks = [
    ...loaded.blocks,
    ...parts.map((part) =>
      markdownData(
        "Attachment",
        [
          ["Path", part.path ?? part.name ?? "Attachment"],
          ["Kind", part.mediaType],
          ["Trust", "untrusted"],
        ],
        "Attached media. Use read with this path to inspect the image again.",
      ),
    ),
  ];
  const entries = loaded.entries.map((entry) => ({
    ...entry,
    mediaIndexes: entry.mediaIndexes.filter((index) => index < media.length),
    blockIndexes: [
      ...entry.blockIndexes,
      ...entry.mediaIndexes.map((index) => loaded.blocks.length + index),
    ],
  }));
  return { parts, blocks, media, snapshot: { media, blocks, entries } };
}

export function toolMediaOptions(options: SessionOptions, sessionId: string) {
  return {
    async saveMedia(parts: readonly ImagePart[]) {
      assertMedia(parts, options.modalities, Boolean(options.vision));
      if (!options.saveMedia)
        throw new Error("Tool media requires durable session attachment storage");
      return options.saveMedia(sessionId, parts);
    },
    async loadMedia(references: import("../attachment-reference").AttachmentReference[]) {
      if (!options.loadMedia) throw new Error("Tool media cannot be restored by this session");
      return options.loadMedia(sessionId, references);
    },
  };
}
