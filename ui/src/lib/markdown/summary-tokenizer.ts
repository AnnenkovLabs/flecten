export type SummaryToken =
  | {
      kind: "open";
      name: string;
      attrs: Array<[string, string]>;
      selfClosing: boolean;
    }
  | { kind: "close"; name: string }
  | { kind: "text"; value: string; raw?: true };

const RAW_TEXT = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
]);

function isNameStart(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isNameChar(char: string): boolean {
  if (isNameStart(char)) return true;
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || char === "-" || char === ":" || char === "_";
}

export function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

function findTagEnd(source: string, start: number): number {
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index + 1;
    }
  }
  return -1;
}

function readName(source: string, start: number): { name: string; end: number } {
  let index = start;
  while (index < source.length && isNameChar(source.charAt(index))) index += 1;
  return { name: source.slice(start, index), end: index };
}

function parseAttributes(source: string, start: number, end: number): Array<[string, string]> {
  const attrs: Array<[string, string]> = [];
  let index = start;
  while (index < end) {
    while (index < end && isSpace(source.charAt(index))) index += 1;
    if (index >= end) break;
    if (source.charAt(index) === "/") {
      index += 1;
      continue;
    }
    const nameStart = index;
    while (
      index < end &&
      !isSpace(source.charAt(index)) &&
      source.charAt(index) !== "=" &&
      source.charAt(index) !== "/" &&
      source.charAt(index) !== ">"
    ) {
      index += 1;
    }
    const name = source.slice(nameStart, index);
    while (index < end && isSpace(source.charAt(index))) index += 1;
    let value = "";
    if (source.charAt(index) === "=") {
      index += 1;
      while (index < end && isSpace(source.charAt(index))) index += 1;
      const quote = source.charAt(index);
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < end && source.charAt(index) !== quote) index += 1;
        value = source.slice(valueStart, index);
        if (index < end) index += 1;
      } else {
        const valueStart = index;
        while (index < end && !isSpace(source.charAt(index)) && source.charAt(index) !== ">") {
          index += 1;
        }
        value = source.slice(valueStart, index);
      }
    }
    if (name.length > 0 && name.charAt(0) !== "/") attrs.push([name, value]);
  }
  return attrs;
}

function parseOpenTag(source: string): SummaryToken | null {
  if (!source.startsWith("<")) return null;
  const opening = readName(source, 1);
  if (opening.name.length === 0) return null;
  const selfClosing = source
    .slice(0, source.length - 1)
    .trimEnd()
    .endsWith("/");
  return {
    kind: "open",
    name: opening.name,
    attrs: parseAttributes(source, opening.end, source.length - 1),
    selfClosing,
  };
}

function findRawClose(source: string, name: string): number {
  const lower = source.toLowerCase();
  const needle = `</${name}`;
  let from = 0;
  while (from < lower.length) {
    const index = lower.indexOf(needle, from);
    if (index < 0) return -1;
    const after = lower.charAt(index + needle.length);
    if (after === ">" || after === "/" || isSpace(after)) return index;
    from = index + needle.length;
  }
  return -1;
}

function incompleteEntityStart(value: string): number {
  const amp = value.lastIndexOf("&");
  if (amp < 0) return -1;
  const tail = value.slice(amp);
  if (tail.length > 32 || tail.includes(";")) return -1;
  for (let index = 1; index < tail.length; index += 1) {
    const char = tail.charAt(index);
    if (!(isNameChar(char) || char === "#")) return -1;
  }
  return amp;
}

export class SummaryHtmlStream {
  #buffer = "";
  #rawName = "";

  push(chunk: string): SummaryToken[] {
    if (chunk.length === 0) return [];
    this.#buffer += chunk;
    return this.#drain(false);
  }

  finish(): SummaryToken[] {
    return this.#drain(true);
  }

  #drain(final: boolean): SummaryToken[] {
    const tokens: SummaryToken[] = [];
    while (this.#buffer.length > 0) {
      if (this.#rawName.length > 0) {
        const close = findRawClose(this.#buffer, this.#rawName);
        if (close < 0) {
          if (!final) break;
          if (this.#buffer.length > 0) {
            tokens.push({ kind: "text", value: this.#buffer, raw: true });
          }
          this.#buffer = "";
          tokens.push({ kind: "close", name: this.#rawName });
          this.#rawName = "";
          break;
        }
        if (close > 0) {
          tokens.push({ kind: "text", value: this.#buffer.slice(0, close), raw: true });
        }
        const end = findTagEnd(this.#buffer, close);
        this.#buffer = end < 0 ? "" : this.#buffer.slice(end);
        tokens.push({ kind: "close", name: this.#rawName });
        this.#rawName = "";
        continue;
      }

      const open = this.#buffer.indexOf("<");
      if (open < 0) {
        const entity = final ? -1 : incompleteEntityStart(this.#buffer);
        const end = entity < 0 ? this.#buffer.length : entity;
        if (end > 0) tokens.push({ kind: "text", value: this.#buffer.slice(0, end) });
        this.#buffer = this.#buffer.slice(end);
        break;
      }
      if (open > 0) {
        tokens.push({ kind: "text", value: this.#buffer.slice(0, open) });
        this.#buffer = this.#buffer.slice(open);
        continue;
      }
      if (this.#buffer.length < 2) {
        if (!final) break;
        tokens.push({ kind: "text", value: "<" });
        this.#buffer = "";
        break;
      }

      if (this.#buffer.startsWith("<!--")) {
        const end = this.#buffer.indexOf("-->", 4);
        if (end < 0) {
          if (final) this.#buffer = "";
          break;
        }
        this.#buffer = this.#buffer.slice(end + 3);
        continue;
      }

      const marker = this.#buffer.charAt(1);
      if (marker === "!" || marker === "?") {
        const end = this.#buffer.indexOf(">", 2);
        if (end < 0) {
          if (final) this.#buffer = "";
          break;
        }
        this.#buffer = this.#buffer.slice(end + 1);
        continue;
      }

      if (marker === "/") {
        const end = this.#buffer.indexOf(">", 2);
        if (end < 0) {
          if (final) this.#buffer = "";
          break;
        }
        const closing = readName(this.#buffer, 2);
        if (closing.name.length > 0) tokens.push({ kind: "close", name: closing.name });
        this.#buffer = this.#buffer.slice(end + 1);
        continue;
      }

      if (!isNameStart(marker)) {
        tokens.push({ kind: "text", value: "<" });
        this.#buffer = this.#buffer.slice(1);
        continue;
      }

      const end = findTagEnd(this.#buffer, 1);
      if (end < 0) {
        if (final) this.#buffer = "";
        break;
      }
      const parsed = parseOpenTag(this.#buffer.slice(0, end));
      this.#buffer = this.#buffer.slice(end);
      if (!parsed) continue;
      tokens.push(parsed);
      if (parsed.kind !== "open") continue;
      const lower = parsed.name.toLowerCase();
      if (!parsed.selfClosing && RAW_TEXT.has(lower)) this.#rawName = lower;
    }
    return tokens;
  }
}
