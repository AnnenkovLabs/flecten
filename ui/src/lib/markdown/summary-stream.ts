import { isSpace } from "./summary-tokenizer";

export interface SplitAnswer {
  text: string;
  summary: string;
  started: boolean;
}

interface BlockTag {
  name: "summary" | "complete";
  open: string;
  close: string;
}

const BLOCK_TAGS: BlockTag[] = [
  { name: "summary", open: "<summary>", close: "</summary>" },
  { name: "complete", open: "<complete>", close: "</complete>" },
];

interface Fence {
  char: string;
  length: number;
}

function fenceAt(line: string): Fence | undefined {
  let index = 0;
  while (index < line.length && (line.charAt(index) === " " || line.charAt(index) === "\t")) {
    index += 1;
  }
  const char = line.charAt(index);
  if (char !== "`" && char !== "~") return undefined;
  let length = 0;
  while (line.charAt(index + length) === char) length += 1;
  return length >= 3 ? { char, length } : undefined;
}

function closesFence(line: string, open: Fence): boolean {
  const fence = fenceAt(line);
  if (!fence || fence.char !== open.char || fence.length < open.length) return false;
  let index = 0;
  while (index < line.length && (line.charAt(index) === " " || line.charAt(index) === "\t")) {
    index += 1;
  }
  return line.slice(index + fence.length).trim().length === 0;
}

function insideInlineCode(line: string, target: number): boolean {
  let ticks = 0;
  for (let index = 0; index < target; index += 1) {
    if (line.charAt(index) === "`" && line.charAt(index - 1) !== "\\") ticks += 1;
  }
  return ticks % 2 === 1;
}

function findOpenBlock(source: string): { tag: BlockTag; start: number } | undefined {
  let fence: Fence | undefined;
  let offset = 0;
  let details = 0;
  for (const line of source.split("\n")) {
    const lower = line.toLowerCase();
    if (fence) {
      if (closesFence(lower, fence)) fence = undefined;
      offset += line.length + 1;
      continue;
    }
    const opened = fenceAt(lower);
    if (opened) {
      fence = opened;
      offset += line.length + 1;
      continue;
    }
    const leading = line.length - line.trimStart().length;
    if (leading >= 4 || lower.trimStart().startsWith(">")) {
      offset += line.length + 1;
      continue;
    }

    let cursor = 0;
    while (cursor < lower.length) {
      const detailsOpen = lower.indexOf("<details", cursor);
      const detailsClose = lower.indexOf("</details", cursor);
      let best = -1;
      let kind = "";
      let tag: BlockTag | undefined;

      for (const candidate of BLOCK_TAGS) {
        const index = lower.indexOf(candidate.open, cursor);
        if (index >= 0 && (best < 0 || index < best)) {
          best = index;
          kind = "block";
          tag = candidate;
        }
      }
      if (detailsOpen >= 0 && (best < 0 || detailsOpen < best)) {
        if (!insideInlineCode(lower, detailsOpen)) {
          best = detailsOpen;
          kind = "details-open";
          tag = undefined;
        }
      }
      if (detailsClose >= 0 && (best < 0 || detailsClose < best)) {
        if (!insideInlineCode(lower, detailsClose)) {
          best = detailsClose;
          kind = "details-close";
          tag = undefined;
        }
      }
      if (best < 0) break;

      if (kind === "details-open") {
        details += 1;
        cursor = best + 8;
        continue;
      }
      if (kind === "details-close") {
        details = Math.max(0, details - 1);
        cursor = best + 9;
        continue;
      }
      if (tag && details === 0 && !insideInlineCode(lower, best)) {
        return { tag, start: offset + best };
      }
      cursor = best + (tag?.open.length ?? 1);
    }
    offset += line.length + 1;
  }
  return undefined;
}

function findClose(source: string, bodyStart: number, tag: BlockTag): number | undefined {
  const lower = source.toLowerCase();
  let depth = 1;
  let cursor = bodyStart;
  while (cursor < lower.length) {
    const nextOpen = lower.indexOf(tag.open, cursor);
    const nextClose = lower.indexOf(tag.close, cursor);
    if (nextClose < 0) return undefined;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + tag.open.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose;
    cursor = nextClose + tag.close.length;
  }
  return undefined;
}

function partialOpenStart(source: string): number {
  const open = source.lastIndexOf("<");
  if (open < 0) return -1;
  const tail = source.slice(open + 1).toLowerCase();
  if (tail.length === 0) return -1;
  if (tail.startsWith("/")) return -1;
  for (const tag of BLOCK_TAGS) {
    if (tag.open.slice(1).startsWith(tail) && tail.length < tag.open.length - 1) return open;
  }
  return -1;
}

function partialCloseLength(summary: string, tag: BlockTag): number {
  const open = summary.lastIndexOf("<");
  if (open < 0) return 0;
  const tail = summary.slice(open).toLowerCase();
  if (tag.close.startsWith(tail) && tail.length < tag.close.length) {
    return summary.length - open;
  }
  return 0;
}

function stripLeadingFence(summary: string): { value: string; fenced: boolean } {
  let index = 0;
  while (index < summary.length && isSpace(summary.charAt(index))) index += 1;
  if (!summary.startsWith("```", index)) return { value: summary, fenced: false };
  const newline = summary.indexOf("\n", index + 3);
  if (newline < 0) return { value: "", fenced: true };
  return { value: summary.slice(newline + 1), fenced: true };
}

function stripTrailingFence(summary: string): string {
  const trimmed = summary.trimEnd();
  if (!trimmed.endsWith("```")) return summary;
  const start = trimmed.length - 3;
  const lineStart = trimmed.lastIndexOf("\n", start - 1) + 1;
  if (trimmed.slice(lineStart, start).trim().length > 0) return summary;
  return trimmed.slice(0, lineStart).trimEnd();
}

// ponytail: rescans the accumulated answer on every delta. Make it incremental if
// summaries ever grow large enough for the repeated scan to matter.
export function splitAnswerStream(source: string): SplitAnswer {
  const block = findOpenBlock(source);
  if (!block) {
    const partial = partialOpenStart(source);
    if (partial >= 0) {
      return { text: source.slice(0, partial).trimEnd(), summary: "", started: true };
    }
    return { text: source, summary: "", started: false };
  }

  const bodyStart = block.start + block.tag.open.length;
  const close = findClose(source, bodyStart, block.tag);
  let summary = close === undefined ? source.slice(bodyStart) : source.slice(bodyStart, close);
  if (close === undefined) {
    const partial = partialCloseLength(summary, block.tag);
    if (partial > 0) summary = summary.slice(0, summary.length - partial);
  }

  const fenced = stripLeadingFence(summary);
  summary = fenced.fenced ? stripTrailingFence(fenced.value) : fenced.value;

  return {
    text: source.slice(0, block.start).trimEnd(),
    summary,
    started: true,
  };
}
