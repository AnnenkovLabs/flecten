import type { Attachment, AttachmentKind, MentionItem } from "./types";

export interface PickedFile {
  path: string;
  name: string;
  size: number;
  kind: string;
}

const KINDS: Record<string, AttachmentKind> = {
  audio: "audio",
  image: "image",
  pdf: "pdf",
  text: "text",
  folder: "folder",
  file: "file",
};

export function attachmentKind(kind: string): AttachmentKind {
  return KINDS[kind] ?? "file";
}

/** Adds picked files as chips. The same path is never attached twice. */
export function addAttachments(
  existing: readonly Attachment[],
  files: readonly PickedFile[],
): Attachment[] {
  const seen = new Set(existing.map((attachment) => attachment.path));
  const next = [...existing];
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    next.push({
      id: crypto.randomUUID(),
      path: file.path,
      name: file.name,
      size: file.size,
      kind: attachmentKind(file.kind),
    });
  }
  return next;
}

function isMentionBoundary(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "";
}

const TRAILING_PUNCTUATION = new Set([",", ".", ";", ":", "!", "?", ")", "]", "}", '"', "'"]);

/**
 * Workspace entries mentioned as `@path`. A token counts only when it names a known file or
 * folder exactly, so typing an e-mail address or a decorator never attaches anything.
 */
export function mentionedPaths(text: string, known: ReadonlySet<string>): string[] {
  const found: string[] = [];
  let at = text.indexOf("@");
  while (at >= 0) {
    const before = at === 0 ? "" : text.charAt(at - 1);
    let end = at + 1;
    while (end < text.length && !isMentionBoundary(text.charAt(end))) end += 1;
    if (isMentionBoundary(before)) {
      let token = text.slice(at + 1, end);
      while (
        token.length > 0 &&
        !known.has(token) &&
        TRAILING_PUNCTUATION.has(token.at(-1) ?? "")
      ) {
        token = token.slice(0, -1);
      }
      if (token.length > 0 && known.has(token) && !found.includes(token)) found.push(token);
    }
    at = text.indexOf("@", end);
  }
  return found;
}

/** Files plus every parent folder, so `@src/app` can attach a folder listing. */
export function mentionEntries(files: readonly string[]): MentionItem[] {
  const folders = new Set<string>();
  for (const file of files) {
    let slash = file.indexOf("/");
    while (slash > 0) {
      folders.add(file.slice(0, slash));
      slash = file.indexOf("/", slash + 1);
    }
  }
  return [
    ...files.map((path) => ({ path, kind: "file" as const })),
    ...[...folders].sort().map((path) => ({ path, kind: "folder" as const })),
  ];
}
