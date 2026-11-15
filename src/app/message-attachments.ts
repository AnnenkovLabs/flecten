import type { HistoryAttachment } from "../../shared/message-branches";
import {
  type AttachmentEntry,
  type AttachmentReference,
  type AttachmentSnapshot,
  AttachmentSnapshotSchema,
} from "../core/attachment-reference";
import { type ContextReference, ContextReferencesSchema } from "../core/context-reference";
import { sessionAttachments } from "../core/session/media";
import type { SessionOptions } from "../core/session/options";
import type { MessageEditOptions } from "./message-branches";

interface AttachmentSource {
  attachmentSnapshot?: AttachmentSnapshot;
  attachments?: AttachmentReference[];
  contexts?: ContextReference[];
}
interface SavedAttachment {
  metadata: HistoryAttachment;
  entry?: AttachmentEntry;
  context?: ContextReference;
}

function snapshotOf(source: AttachmentSource): AttachmentSnapshot {
  const snapshot = source.attachmentSnapshot ?? { media: source.attachments ?? [], blocks: [] };
  if (snapshot.entries) return snapshot;
  // ponytail: legacy snapshots predate file indexes; keep their captured contents as one chip.
  // New snapshots retain per-file entries for individual removal.
  const entries: AttachmentEntry[] =
    snapshot.media.length || snapshot.blocks.length
      ? [
          {
            name: "Saved attachments",
            kind: "file",
            size: snapshot.media.reduce((size, media) => size + media.bytes, 0),
            mediaIndexes: snapshot.media.map((_, index) => index),
            blockIndexes: snapshot.blocks.map((_, index) => index),
          },
        ]
      : [];
  return { ...snapshot, entries };
}

function savedAttachments(source: AttachmentSource, sequence: number): SavedAttachment[] {
  return [
    ...(snapshotOf(source).entries ?? []).map((entry, index) => ({
      metadata: {
        id: `saved_${sequence}_${index}`,
        name: entry.name,
        kind: entry.kind,
        size: entry.size,
      },
      entry,
    })),
    ...(source.contexts ?? []).map((context, index) => ({
      metadata: {
        id: `context_${sequence}_${index}`,
        name: context.label,
        kind: "text" as const,
        size: Buffer.byteLength(context.text),
      },
      context,
    })),
  ];
}

export function historyAttachmentMetadata(
  source: AttachmentSource,
  sequence: number,
): HistoryAttachment[] {
  return savedAttachments(source, sequence).map(({ metadata }) => metadata);
}

function retainSnapshot(
  snapshot: AttachmentSnapshot,
  entries: AttachmentEntry[],
): AttachmentSnapshot {
  const media: AttachmentSnapshot["media"] = [];
  const blocks: string[] = [];
  const retained = entries.map((entry) => ({
    ...entry,
    mediaIndexes: entry.mediaIndexes.map((index) => {
      const value = snapshot.media[index];
      if (!value) throw new Error("Missing saved media attachment");
      return media.push(value) - 1;
    }),
    blockIndexes: entry.blockIndexes.map((index) => {
      const value = snapshot.blocks[index];
      if (value === undefined) throw new Error("Missing saved attachment contents");
      return blocks.push(value) - 1;
    }),
  }));
  return { media, blocks, entries: retained };
}

function appendSnapshots(saved: AttachmentSnapshot, added: AttachmentSnapshot): AttachmentSnapshot {
  return AttachmentSnapshotSchema.parse({
    media: [...saved.media, ...added.media],
    blocks: [...saved.blocks, ...added.blocks],
    entries: [
      ...(saved.entries ?? []),
      ...(added.entries ?? []).map((entry) => ({
        ...entry,
        mediaIndexes: entry.mediaIndexes.map((index) => index + saved.media.length),
        blockIndexes: entry.blockIndexes.map((index) => index + saved.blocks.length),
      })),
    ],
  });
}

export async function editedMessageAttachments(
  source: AttachmentSource,
  sequence: number,
  input: MessageEditOptions,
  id: string,
  options: SessionOptions,
) {
  const original = snapshotOf(source);
  if (input.retainedAttachments === undefined) {
    const prepared = await sessionAttachments(
      input.attachments ?? [],
      id,
      options,
      input.attachments === undefined ? original : undefined,
      { strict: true },
    );
    return { snapshot: prepared.snapshot, contexts: input.contexts ?? source.contexts };
  }
  const sources = savedAttachments(source, sequence);
  const selected = new Set(input.retainedAttachments);
  if (input.retainedAttachments.some((key) => !sources.some(({ metadata }) => metadata.id === key)))
    throw new Error("Unknown saved attachment for this message");
  const retained = sources.filter(({ metadata }) => selected.has(metadata.id));
  const saved = retainSnapshot(
    original,
    retained.flatMap(({ entry }) => (entry ? [entry] : [])),
  );
  const prepared = await sessionAttachments([], id, options, saved, { strict: true });
  const added = await sessionAttachments(input.attachments ?? [], id, options, undefined, {
    strict: true,
  });
  const contexts = ContextReferencesSchema.parse([
    ...retained.flatMap(({ context }) => (context ? [context] : [])),
    ...(input.contexts ?? []),
  ]);
  return { snapshot: appendSnapshots(prepared.snapshot, added.snapshot), contexts };
}
