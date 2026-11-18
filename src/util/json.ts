export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeControlChars(text: string): string {
  const out: string[] = [];
  let inString = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (!inString) {
      if (char === '"') inString = true;
      out.push(char);
      index += 1;
      continue;
    }
    if (char === "\\") {
      out.push(char, text[index + 1] ?? "");
      index += 2;
      continue;
    }
    if (char === '"') {
      inString = false;
      out.push(char);
      index += 1;
      continue;
    }
    const code = char.charCodeAt(0);
    if (code >= 32) {
      out.push(char);
    } else if (char === "\n") {
      out.push("\\n");
    } else if (char === "\r") {
      out.push("\\r");
    } else if (char === "\t") {
      out.push("\\t");
    } else {
      out.push(`\\u${code.toString(16).padStart(4, "0")}`);
    }
    index += 1;
  }
  return out.join("");
}

const SUFFIXES = ['"}', '"}}', "}", '": ""}', "]"];

function repairTruncated(text: string): unknown {
  if (!text.trimStart().startsWith("{")) return undefined;
  for (const suffix of SUFFIXES) {
    try {
      const parsed = JSON.parse(text + suffix) as unknown;
      if (isObject(parsed)) return parsed;
    } catch {}
  }
  return undefined;
}

function parseOnce(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export interface ParseToolArgsOptions {
  allowTruncated?: boolean;
}

export function parseToolArgs(input: unknown, options?: ParseToolArgsOptions): unknown {
  if (typeof input !== "string") return input;
  const text = input.trim();
  if (text.length === 0) return input;
  const allowTruncated = options?.allowTruncated ?? true;

  let parsed = parseOnce(text);
  if (parsed === undefined) parsed = parseOnce(escapeControlChars(text));
  if (allowTruncated && parsed === undefined) parsed = repairTruncated(text);
  if (allowTruncated && parsed === undefined) parsed = repairTruncated(escapeControlChars(text));

  if (typeof parsed === "string") {
    const nested = parseOnce(parsed);
    if (nested !== undefined) parsed = nested;
  }

  return parsed ?? input;
}
