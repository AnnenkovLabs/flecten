import { isSensitiveKey } from "../../util/redact";
import { asciiAlphaNumeric, privateKeys, tokenSecrets } from "./formats";

function keyChar(char: string): boolean {
  return asciiAlphaNumeric(char) || "_.-".includes(char);
}

function quoteEnd(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === quote) return index;
  }
  return text.length;
}

function keyBefore(text: string, separator: number): string {
  let end = separator;
  while (end > 0 && text[end - 1]?.trim() === "") end -= 1;
  if (text[end - 1] === '"' || text[end - 1] === "'") end -= 1;
  let start = end;
  while (start > 0 && keyChar(text[start - 1] ?? "")) start -= 1;
  return text.slice(start, end);
}

function eligible(value: string): boolean {
  return value.length >= 4 && !value.startsWith("[[secret_") && !value.startsWith("[redacted");
}

function assignmentSecrets(text: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "=" && text[index] !== ":") continue;
    if (!isSensitiveKey(keyBefore(text, index))) continue;
    let start = index + 1;
    while (start < text.length && (text[start] === " " || text[start] === "\t")) start += 1;
    const quote = text[start];
    const quoted = quote === '"' || quote === "'" || quote === "`";
    if (quoted) start += 1;
    let end = start;
    if (quoted) end = quoteEnd(text, start - 1);
    else {
      while (end < text.length && !"\r\n,;}".includes(text[end] ?? "")) end += 1;
      const comment = text.indexOf(" #", start);
      if (comment >= start && comment < end) end = comment;
      while (end > start && text[end - 1]?.trim() === "") end -= 1;
    }
    let value = text.slice(start, end);
    const space = value.indexOf(" ");
    if (
      space > 0 &&
      new Set(["bearer", "basic", "token"]).has(value.slice(0, space).toLowerCase())
    ) {
      value = value.slice(space + 1).trim();
    }
    if (eligible(value)) values.push(value);
    if (quoted) index = end;
  }
  return values;
}

function bearerSecrets(text: string): string[] {
  const values: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && !asciiAlphaNumeric(text[cursor] ?? "")) cursor += 1;
    const start = cursor;
    while (cursor < text.length && asciiAlphaNumeric(text[cursor] ?? "")) cursor += 1;
    const scheme = text.slice(start, cursor).toLowerCase();
    if (!new Set(["bearer", "basic"]).has(scheme) || text[cursor]?.trim() !== "") continue;
    while (cursor < text.length && text[cursor]?.trim() === "") cursor += 1;
    const tokenStart = cursor;
    while (
      cursor < text.length &&
      (asciiAlphaNumeric(text[cursor] ?? "") || "-._~+/=".includes(text[cursor] ?? ""))
    )
      cursor += 1;
    const value = text.slice(tokenStart, cursor);
    if (eligible(value)) values.push(value);
  }
  return values;
}

function urlSecrets(text: string): string[] {
  const values: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const marker = text.indexOf("://", cursor);
    if (marker < 0) break;
    let start = marker;
    while (
      start > 0 &&
      (asciiAlphaNumeric(text[start - 1] ?? "") || "+-.".includes(text[start - 1] ?? ""))
    )
      start -= 1;
    let end = marker + 3;
    while (end < text.length && text[end]?.trim() !== "" && !"\"'`<>".includes(text[end] ?? ""))
      end += 1;
    try {
      const url = new URL(text.slice(start, end));
      if (url.password && eligible(url.password)) {
        values.push(url.password, decodeURIComponent(url.password));
        if (url.username) values.push(`${url.username}:${url.password}`);
      }
      const query = url.searchParams;
      for (const [key, value] of query)
        if (isSensitiveKey(key) && eligible(value)) values.push(value);
    } catch {
      // Prose and incomplete URLs are not credential records.
    }
    cursor = end;
  }
  return values;
}

/** Parses credential assignments and validates published token formats; it does not classify intent. */
export function scanSecrets(text: string): string[] {
  return [
    ...new Set([
      ...privateKeys(text),
      ...assignmentSecrets(text),
      ...bearerSecrets(text),
      ...urlSecrets(text),
      ...tokenSecrets(text),
    ]),
  ];
}
