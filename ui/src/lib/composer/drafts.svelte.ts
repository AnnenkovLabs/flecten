import { untrack } from "svelte";
import { t } from "../i18n.svelte";
import { toast } from "../toast.svelte";
import { moveDraft, updateDraft } from "../ui-polish";
import { DraftStorage } from "./draft-storage";
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

let project = "";
let restoredTask: string | null = null;
const loaded = new Set<string>();
const transient = new Set<string>();
const storage = new DraftStorage(undefined, () =>
  toast.error(
    t("Could not save your draft. Keep this window open and free up storage, then try again."),
  ),
);

export function composerProject(): string {
  return project;
}

export function composerTaskKey(task: string): string {
  return JSON.stringify([project, task]);
}

export function composerEditKey(task: string): string {
  const key = composerTaskKey(task);
  transient.add(key);
  return key;
}

export const composerDrafts = $state<ComposerDrafts>({
  task: composerTaskKey("current"),
  values: {},
  documents: {},
  attachments: {},
  insertion: 0,
});

export function setComposerTask(task: string): void {
  storage.flush();
  const key = composerTaskKey(task);
  restore(key);
  composerDrafts.task = key;
  if (project) storage.focus(project, task);
}

export function setComposerProject(cwd: string): void {
  if (cwd === project) return;
  const initial = project === "" ? composerDrafts.task : null;
  storage.flush();
  project = cwd;
  restoredTask = storage.focus(project);
  const key = composerTaskKey("current");
  restore(key);
  if (
    initial &&
    (composerDrafts.documents[initial] || composerDrafts.attachments[initial]?.length)
  ) {
    const saved = composerDrafts.documents[key];
    const typed = composerDrafts.documents[initial];
    if (typed) {
      const prefix = saved?.text ? `${saved.text}\n\n` : "";
      writeComposerDraft(
        prefix + typed.text,
        [
          ...(saved?.mentions ?? []),
          ...typed.mentions.map((mention) => ({
            ...mention,
            start: mention.start + prefix.length,
            end: mention.end + prefix.length,
          })),
        ],
        key,
      );
    }
    writeComposerAttachments(key, [
      ...(composerDrafts.attachments[key] ?? []),
      ...(composerDrafts.attachments[initial] ?? []),
    ]);
    clearComposerDraft(initial);
    restoredTask = null;
    storage.focus(project, "current");
  }
  composerDrafts.task = key;
}

export function savedComposerTask(): string | null {
  return restoredTask === "current" ? null : restoredTask;
}

export function listenComposerDrafts(): () => void {
  return storage.listen(window);
}

function restore(key: string): void {
  if (loaded.has(key)) return;
  loaded.add(key);
  const saved = storage.read(key);
  if (!saved) return;
  composerDrafts.documents[key] = saved.document;
  composerDrafts.values[key] = saved.document.text;
  composerDrafts.attachments[key] = saved.attachments.map(({ path, ...attachment }) =>
    path === undefined ? attachment : { ...attachment, path },
  );
}

function persist(task: string): void {
  if (transient.has(task)) return;
  untrack(() => {
    const document = composerDrafts.documents[task] ?? { text: "", mentions: [] };
    const attachments = (composerDrafts.attachments[task] ?? []).map(
      ({ id, name, size, kind, path }) => ({ id, name, size, kind, ...(path ? { path } : {}) }),
    );
    storage.write(
      task,
      document.text.length || attachments.length ? { document, attachments } : null,
    );
  });
}

export function writeComposerDraft(
  text: string,
  mentions: MentionSpan[] = [],
  task = composerDrafts.task,
): void {
  const previous = untrack(() => composerDrafts.documents[task]);
  if ((previous?.text ?? "") === text && (!text || previous?.mentions === mentions)) return;
  if (text.length > 0) composerDrafts.documents[task] = { text, mentions };
  else delete composerDrafts.documents[task];
  composerDrafts.values = updateDraft(composerDrafts.values, task, text);
  persist(task);
  if (!text) storage.flush();
}

/** A file picker may resolve after navigation. Its files still belong to the task that opened it. */
export function writeComposerAttachments(task: string, attachments: Attachment[]): void {
  const previous = untrack(() => composerDrafts.attachments[task]);
  if (previous === attachments || (!previous?.length && !attachments.length)) return;
  if (attachments.length > 0) composerDrafts.attachments[task] = attachments;
  else delete composerDrafts.attachments[task];
  persist(task);
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
  loaded.add(to);
  persist(to);
  persist(from);
  storage.flush();
}

export function clearComposerDraft(task: string): void {
  composerDrafts.values = updateDraft(composerDrafts.values, task, "");
  delete composerDrafts.documents[task];
  delete composerDrafts.attachments[task];
  persist(task);
  storage.flush();
  transient.delete(task);
}
