import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

export type ReferencePart = { kind: "markdown"; text: string } | { kind: "tool"; id: string };

/** Parse references only in prose text nodes; fenced/inline code, URLs and HTML stay literal. */
export function toolReferences(text: string, known: ReadonlySet<string>): ReferencePart[] {
  const ranges: Array<{ start: number; end: number; id: string }> = [];
  function visit(node: Nodes): void {
    if (node.type === "text") {
      const offset = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (offset === undefined || end === undefined) return;
      // Source offsets are reliable only for literal text, not escaped or entity-decoded text.
      const source = text.slice(offset, end);
      if (source !== node.value) return;
      let cursor = 0;
      while (cursor < source.length) {
        const start = source.indexOf("[[", cursor);
        if (start < 0) break;
        const close = source.indexOf("]]", start + 2);
        if (close < 0) break;
        const id = source.slice(start + 2, close);
        if (known.has(id)) ranges.push({ start: offset + start, end: offset + close + 2, id });
        cursor = close + 2;
      }
    } else if ("children" in node && node.type !== "link" && node.type !== "linkReference") {
      for (const child of node.children) visit(child);
    }
  }
  visit(fromMarkdown(text));
  const parts: ReferencePart[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor)
      parts.push({ kind: "markdown", text: text.slice(cursor, range.start) });
    parts.push({ kind: "tool", id: range.id });
    cursor = range.end;
  }
  if (cursor < text.length || !parts.length)
    parts.push({ kind: "markdown", text: text.slice(cursor) });
  return parts;
}
