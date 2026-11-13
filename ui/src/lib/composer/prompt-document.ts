import type { JSONContent } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import type { ContextReference } from "./context-types";
import type { MentionKind } from "./types";

export interface MentionSpan {
  start: number;
  end: number;
  path: string;
  kind: MentionKind;
  context?: ContextReference | undefined;
  label?: string | undefined;
}

export interface PromptSnapshot {
  text: string;
  mentions: MentionSpan[];
}

/** Expanded coordinates keep the source; the editing document counts an atomic chip as one. */
export function editorPosition(offset: number, mentions: readonly MentionSpan[]): number {
  let removed = 0;
  for (const mention of mentions) {
    if (offset <= mention.start) break;
    if (offset < mention.end) return mention.start - removed + 2;
    removed += mention.end - mention.start - 1;
  }
  return offset - removed + 1;
}

export function sourceOffset(position: number, mentions: readonly MentionSpan[]): number {
  let added = 0;
  const offset = Math.max(0, position - 1);
  for (const mention of mentions) {
    if (offset <= mention.start - added) break;
    added += mention.end - mention.start - 1;
  }
  return offset + added;
}

export function promptContent(text: string, mentions: readonly MentionSpan[]): JSONContent {
  const content: JSONContent[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.start < cursor || text.slice(mention.start, mention.end) !== `@${mention.path}`)
      continue;
    if (mention.start > cursor)
      content.push({ type: "text", text: text.slice(cursor, mention.start) });
    content.push({
      type: "mention",
      attrs: {
        path: mention.path,
        kind: mention.kind,
        context: mention.context,
        label: mention.label,
      },
    });
    cursor = mention.end;
  }
  if (cursor < text.length) content.push({ type: "text", text: text.slice(cursor) });
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

export function promptSnapshot(doc: Node): PromptSnapshot {
  let text = "";
  const mentions: MentionSpan[] = [];
  doc.firstChild?.forEach((node) => {
    if (node.isText) text += node.text ?? "";
    else if (node.type.name === "mention") {
      const path = String(node.attrs.path);
      const start = text.length;
      text += `@${path}`;
      mentions.push({
        start,
        end: text.length,
        path,
        kind: node.attrs.kind,
        ...(node.attrs.context ? { context: node.attrs.context } : {}),
        ...(node.attrs.label ? { label: String(node.attrs.label) } : {}),
      });
    }
  });
  return { text, mentions };
}
