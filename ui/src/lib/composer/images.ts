import type { PickedFile } from "./attachments";
import type { MentionSpan, PromptSnapshot } from "./prompt-document";
import type { MentionItem } from "./types";

export function imageMentions(
  files: readonly PickedFile[],
  existing: readonly MentionSpan[],
): MentionItem[] {
  const paths = new Set(existing.filter((item) => item.kind === "image").map((item) => item.path));
  const labels = new Set(
    existing.filter((item) => item.kind === "image").map((item) => item.label),
  );
  const result: MentionItem[] = [];
  let index = 1;
  for (const file of files) {
    if (file.kind !== "image" || paths.has(file.path)) continue;
    while (labels.has(`Image ${index}`)) index++;
    const label = `Image ${index++}`;
    result.push({ kind: "image", path: file.path, label });
    labels.add(label);
    paths.add(file.path);
  }
  return result;
}

/** An asynchronous paste still belongs to its originating task after navigation. */
export function appendImageMentions(
  snapshot: PromptSnapshot,
  images: readonly MentionItem[],
): PromptSnapshot {
  let text = snapshot.text;
  const mentions = [...snapshot.mentions];
  for (const image of images) {
    if (text && !text.endsWith(" ") && !text.endsWith("\n")) text += " ";
    const start = text.length;
    text += `@${image.path}`;
    mentions.push({ start, end: text.length, path: image.path, kind: "image", label: image.label });
    text += " ";
  }
  return { text, mentions };
}
