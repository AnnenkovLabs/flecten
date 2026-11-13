// String fields of a JSON object that is still streaming in: read without waiting for it to close.

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };

interface Scanned {
  value: string;
  end: number;
}

/** A JSON string whose opening quote is at `start`, decoded up to its closing quote or the end. */
function readString(text: string, start: number): Scanned {
  let value = "";
  let at = start + 1;
  while (at < text.length) {
    const char = text[at] ?? "";
    if (char === '"') return { value, end: at + 1 };
    if (char !== "\\") {
      value += char;
      at += 1;
      continue;
    }
    const code = text[at + 1];
    if (code === undefined) break;
    if (code === "u") {
      const hex = text.slice(at + 2, at + 6);
      const point = Number.parseInt(hex, 16);
      if (hex.length < 4 || Number.isNaN(point)) break;
      value += String.fromCharCode(point);
      at += 6;
      continue;
    }
    value += ESCAPES[code] ?? code;
    at += 2;
  }
  return { value, end: text.length };
}

function skipSpaces(text: string, start: number): number {
  let at = start;
  while (at < text.length && (text[at] ?? "").trim() === "") at += 1;
  return at;
}

/** The first string value, in text order, stored under one of `keys`; undefined when none has started yet. */
export function streamingField(text: string, keys: readonly string[]): string | undefined {
  let at = 0;
  while (at < text.length) {
    if (text[at] !== '"') {
      at += 1;
      continue;
    }
    const key = readString(text, at);
    const colon = skipSpaces(text, key.end);
    if (text[colon] !== ":") {
      at = key.end;
      continue;
    }
    const valueStart = skipSpaces(text, colon + 1);
    if (text[valueStart] !== '"') {
      at = valueStart;
      continue;
    }
    const value = readString(text, valueStart);
    if (keys.includes(key.value)) return value.value;
    at = value.end;
  }
  return undefined;
}

/** Whitespace runs as single spaces, trimmed: one readable line for previews. */
export function oneLine(text: string): string {
  let line = "";
  let space = false;
  for (const char of text) {
    if (char.trim() === "") {
      space = line.length > 0;
      continue;
    }
    if (space) line += " ";
    line += char;
    space = false;
  }
  return line;
}
