export interface CodeSymbol {
  readonly name: string;
  readonly kind: "function" | "class" | "interface" | "type" | "const" | "method";
  readonly startLine: number;
  readonly endLine: number;
}

const DEFINITION_PREFIXES: ReadonlyArray<{
  readonly prefix: string;
  readonly kind: CodeSymbol["kind"];
}> = [
  { prefix: "export async function ", kind: "function" },
  { prefix: "export default async function ", kind: "function" },
  { prefix: "export default function ", kind: "function" },
  { prefix: "export function ", kind: "function" },
  { prefix: "async function ", kind: "function" },
  { prefix: "function ", kind: "function" },
  { prefix: "export abstract class ", kind: "class" },
  { prefix: "export default class ", kind: "class" },
  { prefix: "export class ", kind: "class" },
  { prefix: "abstract class ", kind: "class" },
  { prefix: "class ", kind: "class" },
  { prefix: "export interface ", kind: "interface" },
  { prefix: "interface ", kind: "interface" },
  { prefix: "export type ", kind: "type" },
  { prefix: "type ", kind: "type" },
  { prefix: "export const ", kind: "const" },
  { prefix: "export let ", kind: "const" },
  { prefix: "const ", kind: "const" },
  { prefix: "pub async fn ", kind: "function" },
  { prefix: "pub fn ", kind: "function" },
  { prefix: "async fn ", kind: "function" },
  { prefix: "fn ", kind: "function" },
  { prefix: "pub struct ", kind: "class" },
  { prefix: "struct ", kind: "class" },
  { prefix: "pub enum ", kind: "type" },
  { prefix: "enum ", kind: "type" },
  { prefix: "pub trait ", kind: "interface" },
  { prefix: "trait ", kind: "interface" },
  { prefix: "async def ", kind: "function" },
  { prefix: "def ", kind: "function" },
  { prefix: "func ", kind: "function" },
];

const CONTROL_WORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "throw",
  "else",
  "do",
  "try",
  "finally",
  "match",
  "loop",
]);

function isWordStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;
}

function isWordChar(code: number): boolean {
  return isWordStart(code) || (code >= 48 && code <= 57);
}

function readIdentifierAt(text: string, start: number): string | undefined {
  let cursor = start;
  while (
    cursor < text.length &&
    (text[cursor] === " " || text[cursor] === "\t" || text[cursor] === "*")
  ) {
    cursor += 1;
  }
  if (cursor >= text.length || !isWordStart(text.charCodeAt(cursor))) return undefined;
  const begin = cursor;
  while (cursor < text.length && isWordChar(text.charCodeAt(cursor))) {
    cursor += 1;
  }
  const name = text.slice(begin, cursor);
  return CONTROL_WORDS.has(name) ? undefined : name;
}

function goReceiverCleared(rest: string): string {
  const trimmed = rest.trimStart();
  if (!trimmed.startsWith("(")) return trimmed;
  const close = trimmed.indexOf(")");
  return close >= 0 ? trimmed.slice(close + 1).trimStart() : trimmed;
}

function matchMethodHeader(
  trimmed: string,
  indent: number,
): { name: string; kind: CodeSymbol["kind"] } | undefined {
  if (indent < 1 || indent > 6) return undefined;
  if (!trimmed.endsWith("{") && !trimmed.includes("):")) return undefined;
  let rest = trimmed;
  for (const mod of [
    "public ",
    "private ",
    "protected ",
    "static ",
    "readonly ",
    "override ",
    "async ",
    "get ",
    "set ",
  ]) {
    if (rest.startsWith(mod)) rest = rest.slice(mod.length).trimStart();
  }
  const name = readIdentifierAt(rest, 0);
  if (!name) return undefined;
  const after = rest.slice(name.length).trimStart();
  if (!after.startsWith("(") && !after.startsWith("<")) return undefined;
  return { name, kind: "method" };
}

function matchArrowConstHeader(
  trimmed: string,
  indent: number,
): { name: string; kind: CodeSymbol["kind"]; indent: number } | undefined {
  let rest = trimmed;
  if (rest.startsWith("export default ")) rest = rest.slice("export default ".length).trimStart();
  else if (rest.startsWith("export ")) rest = rest.slice("export ".length).trimStart();
  for (const kw of ["const ", "let ", "var "]) {
    if (rest.startsWith(kw)) {
      rest = rest.slice(kw.length).trimStart();
      const name = readIdentifierAt(rest, 0);
      if (!name) return undefined;
      const eq = rest.indexOf("=");
      if (eq < 0) return undefined;
      const rhs = rest.slice(eq + 1).trimStart();
      if (rhs.includes("=>") || rhs.startsWith("async ") || rhs.startsWith("function")) {
        return { name, kind: "function", indent };
      }
      if (indent === 0) return { name, kind: "const", indent };
      return undefined;
    }
  }
  return undefined;
}

export function detectLineSymbol(
  line: string,
): { name: string; kind: CodeSymbol["kind"]; indent: number } | undefined {
  let indent = 0;
  while (indent < line.length && (line[indent] === " " || line[indent] === "\t")) {
    indent += 1;
  }
  const trimmed = line.slice(indent);
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  ) {
    return undefined;
  }
  const arrow = matchArrowConstHeader(trimmed, indent);
  if (arrow) return arrow;
  for (const entry of DEFINITION_PREFIXES) {
    if (trimmed.startsWith(entry.prefix)) {
      const rest =
        entry.prefix === "func "
          ? goReceiverCleared(trimmed.slice(entry.prefix.length))
          : trimmed.slice(entry.prefix.length);
      const name = readIdentifierAt(rest, 0);
      if (!name) return undefined;
      if (entry.kind === "const" && indent > 0) return undefined;
      return { name, kind: entry.kind, indent };
    }
  }
  const method = matchMethodHeader(trimmed, indent);
  return method ? { ...method, indent } : undefined;
}

/**
 * Splits compound identifiers (camelCase, PascalCase, snake_case) into lowercase subtokens
 * while also keeping the full lowercased identifier (matching Semble/Probe split_identifier).
 */
export function splitIdentifier(token: string): string[] {
  const lower = token.toLowerCase();
  if (lower.length < 2) return [];
  const parts: string[] = [];
  if (token.includes("_") || token.includes("-")) {
    let part = "";
    for (let i = 0; i < lower.length; i += 1) {
      const ch = lower[i];
      if (ch === "_" || ch === "-") {
        if (part.length >= 2) parts.push(part);
        part = "";
      } else {
        part += ch;
      }
    }
    if (part.length >= 2) parts.push(part);
  } else {
    let current = "";
    for (let i = 0; i < token.length; i += 1) {
      const code = token.charCodeAt(i);
      const isUpper = code >= 65 && code <= 90;
      if (isUpper && current.length > 0) {
        const prevCode = token.charCodeAt(i - 1);
        const prevIsLowerOrDigit =
          (prevCode >= 97 && prevCode <= 122) || (prevCode >= 48 && prevCode <= 57);
        const nextCode = i + 1 < token.length ? token.charCodeAt(i + 1) : 0;
        const nextIsLower = nextCode >= 97 && nextCode <= 122;
        if (prevIsLowerOrDigit || nextIsLower) {
          if (current.length >= 2) parts.push(current.toLowerCase());
          current = "";
        }
      }
      current += token[i];
    }
    if (current.length >= 2) parts.push(current.toLowerCase());
  }
  if (parts.length >= 2) return [lower, ...parts];
  return [lower];
}

/** Splits code text and camelCase/snake_case identifiers into lowercase subtokens for BM25 ranking. */
export function tokenizeIdentifierTerms(text: string): string[] {
  const tokens: string[] = [];
  let current = "";

  const flush = (): void => {
    if (current.length >= 2) {
      tokens.push(...splitIdentifier(current));
    }
    current = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    const isSep = code === 95;

    if (!isUpper && !isLower && !isDigit && !isSep) {
      flush();
      continue;
    }
    current += text[index];
  }
  flush();
  return tokens;
}

function braceDelta(line: string): number {
  let delta = 0;
  let inSingle = false;
  let inDouble = false;
  let inTick = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : "";
    if (!inDouble && !inTick && ch === "'" && prev !== "\\") inSingle = !inSingle;
    else if (!inSingle && !inTick && ch === '"' && prev !== "\\") inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === "`" && prev !== "\\") inTick = !inTick;
    else if (!inSingle && !inDouble && !inTick) {
      if (ch === "/" && line[i + 1] === "/") break;
      if (ch === "{") delta += 1;
      else if (ch === "}") delta -= 1;
    }
  }
  return delta;
}

/** Extracts top-level and method symbols with 1-based line ranges. */
export function extractCodeSymbols(lines: readonly string[]): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const detected = detectLineSymbol(line);
    if (!detected) continue;

    const startLine = index + 1;
    const isPython =
      line.trimStart().startsWith("def ") || line.trimStart().startsWith("async def ");
    let endLine = startLine;

    if (isPython) {
      for (let probe = index + 1; probe < lines.length; probe += 1) {
        const candidate = lines[probe] ?? "";
        const trimmed = candidate.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
        let indent = 0;
        while (
          indent < candidate.length &&
          (candidate[indent] === " " || candidate[indent] === "\t")
        ) {
          indent += 1;
        }
        if (indent <= detected.indent) break;
        endLine = probe + 1;
      }
    } else {
      let balance = braceDelta(line);
      let opened = line.includes("{");
      for (let probe = index + 1; probe < lines.length && probe <= index + 400; probe += 1) {
        if (!opened) {
          const candidate = lines[probe] ?? "";
          if (candidate.includes("{")) {
            opened = true;
            balance += braceDelta(candidate);
            endLine = probe + 1;
            if (balance <= 0) break;
            continue;
          }
          if (candidate.trimEnd().endsWith(";") || probe > index + 6) break;
          endLine = probe + 1;
          continue;
        }
        const candidate = lines[probe] ?? "";
        balance += braceDelta(candidate);
        endLine = probe + 1;
        if (balance <= 0) break;
      }
    }
    symbols.push({
      name: detected.name,
      kind: detected.kind,
      startLine,
      endLine,
    });
  }
  return symbols;
}

export function enclosingSymbolForLine(
  symbols: readonly CodeSymbol[],
  line1Based: number,
): CodeSymbol | undefined {
  let best: CodeSymbol | undefined;
  for (const symbol of symbols) {
    if (line1Based >= symbol.startLine && line1Based <= symbol.endLine) {
      if (!best || symbol.endLine - symbol.startLine <= best.endLine - best.startLine) {
        best = symbol;
      }
    }
  }
  return best;
}
