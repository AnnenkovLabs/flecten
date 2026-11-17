import { addAttachments, type PickedFile } from "./attachments";
import { composerDrafts, writeComposerAttachments, writeComposerDraft } from "./drafts.svelte";
import { appendImageMentions, imageMentions } from "./images";
import type { PromptSnapshot } from "./prompt-document";
import type { Attachment, MentionItem } from "./types";

/** Async pickers retain their destination when the user switches tasks or opens an edit. */
export function attachDraftFiles(
  task: string,
  files: PickedFile[],
  current?: PromptSnapshot & {
    attachments: Attachment[];
    insertImages(items: MentionItem[]): void;
  },
): Attachment[] {
  const existing = current?.attachments ?? composerDrafts.attachments[task] ?? [];
  const snapshot = current ?? composerDrafts.documents[task] ?? { text: "", mentions: [] };
  const images = imageMentions(files, snapshot.mentions);
  if (current) current.insertImages(images);
  else if (images.length) {
    const updated = appendImageMentions(snapshot, images);
    writeComposerDraft(updated.text, updated.mentions, task);
  }
  const next = addAttachments(
    existing,
    files.filter((file) => file.kind !== "image"),
  );
  writeComposerAttachments(task, next);
  return next;
}
