import { marked } from "marked";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { type DefaultTreeAdapterTypes, parseFragment } from "parse5";

type MarkdownNode = ReturnType<typeof fromMarkdown>["children"][number];
type HtmlNode = DefaultTreeAdapterTypes.Node;
interface Span {
  start: number;
  end: number;
  html: boolean;
}
const OPAQUE = new Set(["script", "style", "code", "pre", "svg", "math", "textarea"]);
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

/** Translate text nodes by source position, never by reserializing code or markup. */
export function translationDocument(source: string) {
  const spans: Span[] = [];
  function add(start: number, end: number, html: boolean): void {
    const raw = source.slice(start, end);
    start += raw.length - raw.trimStart().length;
    end -= raw.length - raw.trimEnd().length;
    if (start >= end) return;
    const words = [...segmenter.segment(source.slice(start, end))];
    if (!words.some((word) => word.isWordLike)) return;
    let cursor = start;
    let size = 0;
    for (const word of words) {
      if (size && size + word.segment.length > 2000) {
        spans.push({ start: cursor, end: cursor + size, html });
        cursor += size;
        size = 0;
      }
      for (const char of word.segment) {
        if (size + char.length > 2000) {
          spans.push({ start: cursor, end: cursor + size, html });
          cursor += size;
          size = 0;
        }
        size += char.length;
      }
    }
    if (size) spans.push({ start: cursor, end: cursor + size, html });
  }
  function htmlNodes(text: string, offset: number): Span[] {
    const ranges: Span[] = [];
    function visit(node: HtmlNode): void {
      if (
        "tagName" in node &&
        (OPAQUE.has(node.tagName) ||
          node.attrs.some(
            (attr) =>
              (attr.name === "translate" && attr.value === "no") ||
              (attr.name === "class" && attr.value.split(" ").includes("notranslate")),
          ))
      )
        return;
      if (node.nodeName === "#text" && node.sourceCodeLocation) {
        const { startOffset, endOffset } = node.sourceCodeLocation;
        ranges.push({ start: offset + startOffset, end: offset + endOffset, html: true });
      }
      if ("childNodes" in node) for (const child of node.childNodes) visit(child);
    }
    visit(parseFragment(text, { sourceCodeLocationInfo: true }));
    return ranges;
  }
  function walk(nodes: readonly MarkdownNode[], allowed?: Span[]): void {
    for (const node of nodes) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined)
        throw new Error("Translation document lost source positions");
      if (node.type === "html") {
        if (!allowed)
          for (const range of htmlNodes(source.slice(start, end), start))
            add(range.start, range.end, true);
        continue;
      }
      if (
        node.type === "code" ||
        node.type === "inlineCode" ||
        node.type === "image" ||
        node.type === "imageReference" ||
        node.type === "definition"
      )
        continue;
      if (
        node.type === "link" &&
        node.children.length === 1 &&
        node.children[0]?.type === "text" &&
        (node.children[0].value === node.url || `mailto:${node.children[0].value}` === node.url)
      )
        continue;
      if ("children" in node) {
        // Inline HTML has separate open/close nodes; parse their common parent to retain opaque elements.
        if (node.children.some((child) => child.type === "html")) {
          const origin = start;
          let masked = source.slice(start, end);
          function maskLiteral(children: readonly MarkdownNode[]): void {
            for (const child of children) {
              if (child.type === "inlineCode" && child.position) {
                const childStart = child.position.start.offset;
                const childEnd = child.position.end.offset;
                if (childStart === undefined || childEnd === undefined)
                  throw new Error("Missing inline code positions");
                const first = childStart - origin;
                const last = childEnd - origin;
                masked = masked.slice(0, first) + " ".repeat(last - first) + masked.slice(last);
              } else if ("children" in child) maskLiteral(child.children as MarkdownNode[]);
            }
          }
          maskLiteral(node.children as MarkdownNode[]);
          walk(node.children as MarkdownNode[], htmlNodes(masked, start));
        } else walk(node.children as MarkdownNode[], allowed);
      } else if (node.type === "text") {
        const lines = source.slice(start, end).split("\n");
        const values = node.value.split("\n");
        let offset = start;
        lines.forEach((line, index) => {
          const value = values[index];
          const prefix =
            value !== undefined && line.endsWith(value) ? line.length - value.length : 0;
          if (allowed) {
            for (const range of allowed)
              add(
                Math.max(offset + prefix, range.start),
                Math.min(offset + line.length, range.end),
                true,
              );
          } else add(offset + prefix, offset + line.length, false);
          offset += line.length + 1;
        });
      }
    }
  }
  walk(
    fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }).children,
  );
  spans.sort((a, b) => a.start - b.start);
  const texts = spans.map((span) => {
    const raw = source.slice(span.start, span.end);
    return span.html
      ? parseFragment(raw)
          .childNodes.map((node) =>
            node.nodeName === "#text" && "value" in node ? node.value : "",
          )
          .join("")
      : raw;
  });
  return {
    texts,
    restore(translated: readonly string[]): string {
      if (translated.length !== spans.length) throw new Error("Translation segment count mismatch");
      let result = "";
      let cursor = 0;
      spans.forEach((span, index) => {
        if (span.start < cursor) throw new Error("Overlapping translation spans");
        let text = translated[index] ?? "";
        if (text === texts[index]) text = source.slice(span.start, span.end);
        else if (span.html)
          text = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        result += source.slice(cursor, span.start) + text;
        cursor = span.end;
      });
      return result + source.slice(cursor);
    },
  };
}

/** Hold the last Markdown block because a later delta can still change its syntax. */
export function stableTranslationPrefix(text: string): number {
  const tokens = marked.lexer(text);
  const prefix = tokens.slice(0, -1).reduce((size, token) => size + token.raw.length, 0);
  const last = tokens.at(-1);
  if (last?.type !== "paragraph" || !last.tokens?.every((token) => token.type === "text"))
    return prefix;
  const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(last.raw)];
  return prefix + (sentences.at(-1)?.index ?? 0);
}
