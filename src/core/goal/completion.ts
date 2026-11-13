import type { CompletionSignal } from "./types";

const COMPLETE_OPEN = "<complete>";
const COMPLETE_CLOSE = "</complete>";
const SUMMARY_OPEN = "<summary>";
const SUMMARY_CLOSE = "</summary>";

interface TrailingBlock {
  openStart: number;
  bodyStart: number;
  closeStart: number;
}

function isHorizontalSpace(char: string): boolean {
  return char === " " || char === "\t";
}

function isWhitespace(char: string): boolean {
  return char.trim() === "";
}

function isWordChar(char: string): boolean {
  if (char === "") return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

function fenceAt(text: string, index: number): { char: string; length: number } | undefined {
  const char = text[index];
  if (char !== "`" && char !== "~") return undefined;
  let length = 0;
  while (text[index + length] === char) length += 1;
  if (length < 3) return undefined;
  return { char, length };
}

function isBlockquoteLine(text: string, index: number): boolean {
  let start = index;
  while (start > 0 && text[start - 1] !== "\n") start -= 1;
  let cursor = start;
  while (cursor < text.length && isHorizontalSpace(text[cursor] ?? "")) cursor += 1;
  return text[cursor] === ">";
}

function isPlainAt(text: string, target: number): boolean {
  if (isBlockquoteLine(text, target)) return false;

  let fenceChar = "";
  let fenceLength = 0;
  let quote = "";
  let escaped = false;
  let lineStart = true;
  let index = 0;

  while (index < target) {
    const char = text[index] ?? "";

    if (fenceChar !== "") {
      if (lineStart) {
        const fence = fenceAt(text, index);
        if (fence && fence.char === fenceChar && fence.length >= fenceLength) {
          fenceChar = "";
          fenceLength = 0;
          index += fence.length;
          lineStart = false;
          continue;
        }
      }
      if (char === "\n") {
        lineStart = true;
      } else if (!isHorizontalSpace(char)) {
        lineStart = false;
      }
      index += 1;
      continue;
    }

    if (char === "\n") {
      lineStart = true;
      index += 1;
      continue;
    }
    if (lineStart && isHorizontalSpace(char)) {
      index += 1;
      continue;
    }
    if (lineStart) {
      if (quote === "") {
        const fence = fenceAt(text, index);
        if (fence) {
          fenceChar = fence.char;
          fenceLength = fence.length;
          index += fence.length;
          lineStart = false;
          continue;
        }
      }
      lineStart = false;
    }

    if (quote === "") {
      if (char === '"' || char === "`") {
        quote = char;
      } else if (char === "'" && !isWordChar(text[index - 1] ?? "")) {
        quote = "'";
      } else if (char === "“" || char === "«") {
        quote = char === "“" ? "”" : "»";
      } else if (char === "‘" && !isWordChar(text[index - 1] ?? "")) {
        quote = "’";
      }
      index += 1;
      continue;
    }

    if (quote === '"' || quote === "'") {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        if (quote === "'" && isWordChar(text[index + 1] ?? "")) {
          index += 1;
          continue;
        }
        quote = "";
      }
      index += 1;
      continue;
    }

    if (quote === "`") {
      if (char === "`") quote = "";
      index += 1;
      continue;
    }

    if (char === quote) quote = "";
    index += 1;
  }

  return fenceChar === "" && quote === "";
}

function matchingOpenStart(
  text: string,
  open: string,
  close: string,
  closeStart: number,
): number | undefined {
  let depth = 0;
  let index = closeStart;
  while (index > 0) {
    const previousClose = text.lastIndexOf(close, index - 1);
    const previousOpen = text.lastIndexOf(open, index - 1);
    if (previousOpen < 0) return undefined;
    if (previousClose > previousOpen) {
      depth += 1;
      index = previousClose;
      continue;
    }
    if (depth === 0) return previousOpen;
    depth -= 1;
    index = previousOpen;
  }
  return undefined;
}

function trailingBlock(text: string): TrailingBlock | undefined {
  const blocks = [
    { open: COMPLETE_OPEN, close: COMPLETE_CLOSE },
    { open: SUMMARY_OPEN, close: SUMMARY_CLOSE },
  ];

  for (const block of blocks) {
    if (!text.endsWith(block.close)) continue;
    const closeStart = text.length - block.close.length;
    const openStart = matchingOpenStart(text, block.open, block.close, closeStart);
    if (openStart === undefined) continue;
    const bodyStart = openStart + block.open.length;
    if (bodyStart > closeStart) continue;
    if (!isPlainAt(text, openStart) || !isPlainAt(text, closeStart)) continue;
    return { openStart, bodyStart, closeStart };
  }

  return undefined;
}

export function parseCompletionSignal(input: string): CompletionSignal {
  let end = input.length;
  while (end > 0 && isWhitespace(input[end - 1] ?? "")) end -= 1;
  const trimmed = input.slice(0, end);
  const block = trailingBlock(trimmed);
  if (block === undefined) {
    return { text: input, summary: "", complete: false };
  }
  if (!isPlainAt(trimmed, block.openStart) || !isPlainAt(trimmed, block.closeStart)) {
    return { text: input, summary: "", complete: false };
  }
  return {
    text: trimmed.slice(0, block.openStart).trimEnd(),
    summary: trimmed.slice(block.bodyStart, block.closeStart).trim(),
    complete: true,
  };
}
