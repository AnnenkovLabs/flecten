import { moveDraft, updateDraft } from "../ui-polish";
import type { MentionSpan, PromptSnapshot } from "./prompt-document";
import type { Attachment } from "./types";

/** Unsent composer text per task, so switching tasks keeps what was typed in each. */
interface ComposerDrafts {
  task: string;
  values: Record<string, string>;
  documents: Record<string, PromptSnapshot>;
  attachments: Record<string, Attachment[]>;
  /** Explicit insertion from another surface, distinct from normal editor updates. */
  insertion: number;
}

export const composerDrafts = $state<ComposerDrafts>({
  task: "current",
  values: {},
  documents: {},
  attachments: {},
  insertion: 0,
});

export function setComposerTask(task: string): void {
  composerDrafts.task = task;
}

export function writeComposerDraft(text: string, mentions: MentionSpan[] = []): void {
  if (text.length > 0) composerDrafts.documents[composerDrafts.task] = { text, mentions };
  else delete composerDrafts.documents[composerDrafts.task];
  composerDrafts.values = updateDraft(composerDrafts.values, composerDrafts.task, text);
}

/** A file picker may resolve after navigation. Its files still belong to the task that opened it. */
export function writeComposerAttachments(task: string, attachments: Attachment[]): void {
  if (attachments.length > 0) composerDrafts.attachments[task] = attachments;
  else delete composerDrafts.attachments[task];
}

export function moveComposerDraft(from: string, to: string): void {
  if (from === to) return;
  const document = composerDrafts.documents[from];
  const attachments = composerDrafts.attachments[from];
  composerDrafts.values = moveDraft(composerDrafts.values, from, to);
  if (document) composerDrafts.documents[to] = document;
  delete composerDrafts.documents[from];
  if (attachments) composerDrafts.attachments[to] = attachments;
  delete composerDrafts.attachments[from];
}

export function clearComposerDraft(task: string): void {
  composerDrafts.values = updateDraft(composerDrafts.values, task, "");
  delete composerDrafts.documents[task];
  delete composerDrafts.attachments[task];
}
