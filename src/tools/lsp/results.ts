import { fileURLToPath } from "node:url";
import { displayPath } from "../util/paths";
import type { LspDiagnostic } from "./client";

export interface LspLocation {
  file: string;
  line: number;
  character: number;
}

export interface LspDiagnosticView {
  file: string;
  line: number;
  character: number;
  severity: string;
  message: string;
  source?: string;
  code?: string | number;
}

export interface LspSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  character: number;
}

export interface LspTextEdit {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  newText: string;
}

const SEVERITY_NAMES = ["error", "warning", "information", "hint"] as const;

const SYMBOL_KINDS = [
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enum member",
  "struct",
  "event",
  "operator",
  "type parameter",
] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPosition(value: unknown): { line: number; character: number } | undefined {
  if (!isRecord(value)) return undefined;
  const { line, character } = value;
  if (typeof line !== "number" || !Number.isInteger(line) || line < 0) return undefined;
  if (typeof character !== "number" || !Number.isInteger(character) || character < 0) {
    return undefined;
  }
  return { line, character };
}

function uriFile(uri: string, cwd: string): string {
  if (!uri.startsWith("file:")) return uri;
  try {
    return displayPath(cwd, fileURLToPath(uri));
  } catch {
    return uri;
  }
}

function readLocation(value: unknown, cwd: string): LspLocation | undefined {
  if (!isRecord(value)) return undefined;
  const uri =
    typeof value.uri === "string"
      ? value.uri
      : typeof value.targetUri === "string"
        ? value.targetUri
        : undefined;
  if (!uri) return undefined;
  const range = isRecord(value.targetSelectionRange)
    ? value.targetSelectionRange
    : isRecord(value.targetRange)
      ? value.targetRange
      : isRecord(value.range)
        ? value.range
        : undefined;
  const start = range && isRecord(range.start) ? readPosition(range.start) : undefined;
  if (!start) return undefined;
  return {
    file: uriFile(uri, cwd),
    line: start.line + 1,
    character: start.character + 1,
  };
}

export function normalizeLocations(result: unknown, cwd: string): LspLocation[] {
  if (result === null || result === undefined) return [];
  const items = Array.isArray(result) ? result : [result];
  const locations: LspLocation[] = [];
  for (const item of items) {
    const location = readLocation(item, cwd);
    if (location) locations.push(location);
  }
  return locations;
}

export function diagnosticView(diagnostic: LspDiagnostic, file: string): LspDiagnosticView {
  const severity =
    diagnostic.severity !== undefined
      ? (SEVERITY_NAMES[diagnostic.severity - 1] ?? "unknown")
      : "unknown";
  return {
    file,
    line: diagnostic.range.start.line + 1,
    character: diagnostic.range.start.character + 1,
    severity,
    message: diagnostic.message,
    ...(diagnostic.source !== undefined ? { source: diagnostic.source } : {}),
    ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
  };
}

function symbolStart(
  value: Record<string, unknown>,
): { line: number; character: number } | undefined {
  if (isRecord(value.location) && isRecord(value.location.range)) {
    if (isRecord(value.location.range.start)) return readPosition(value.location.range.start);
  }
  if (isRecord(value.range) && isRecord(value.range.start)) {
    return readPosition(value.range.start);
  }
  return undefined;
}

export function collectSymbols(value: unknown, file: string, output: LspSymbol[]): void {
  if (!isRecord(value) || typeof value.name !== "string") return;
  const start = symbolStart(value);
  if (start) {
    output.push({
      name: value.name,
      kind:
        typeof value.kind === "number" ? (SYMBOL_KINDS[value.kind - 1] ?? "unknown") : "unknown",
      file,
      line: start.line + 1,
      character: start.character + 1,
    });
  }
  if (Array.isArray(value.children)) {
    for (const child of value.children) collectSymbols(child, file, output);
  }
}

function readTextEdit(value: unknown, uri: string, cwd: string): LspTextEdit | undefined {
  if (!isRecord(value) || typeof value.newText !== "string" || !isRecord(value.range)) {
    return undefined;
  }
  const start = readPosition(value.range.start);
  const end = readPosition(value.range.end);
  if (!start || !end) return undefined;
  return {
    file: uriFile(uri, cwd),
    line: start.line + 1,
    character: start.character + 1,
    endLine: end.line + 1,
    endCharacter: end.character + 1,
    newText: value.newText,
  };
}

function readChanges(value: unknown, cwd: string, output: LspTextEdit[]): void {
  if (!isRecord(value)) return;
  for (const [uri, edits] of Object.entries(value)) {
    if (!Array.isArray(edits)) continue;
    for (const edit of edits) {
      const parsed = readTextEdit(edit, uri, cwd);
      if (parsed) output.push(parsed);
    }
  }
}

export function readWorkspaceEdit(value: unknown, cwd: string): LspTextEdit[] {
  if (!isRecord(value)) return [];
  const edits: LspTextEdit[] = [];
  readChanges(value.changes, cwd, edits);
  if (Array.isArray(value.documentChanges)) {
    for (const change of value.documentChanges) {
      if (!isRecord(change) || !isRecord(change.textDocument)) continue;
      const uri = change.textDocument.uri;
      if (typeof uri !== "string" || !Array.isArray(change.edits)) continue;
      for (const edit of change.edits) {
        const parsed = readTextEdit(edit, uri, cwd);
        if (parsed) edits.push(parsed);
      }
    }
  }
  return edits;
}

export function formatLocations(label: string, locations: LspLocation[]): string {
  const header = `${label}: ${locations.length} location${locations.length === 1 ? "" : "s"}`;
  if (locations.length === 0) return `${header}\n(no locations)`;
  return [header, ...locations.map((item) => `${item.file}:${item.line}:${item.character}`)].join(
    "\n",
  );
}

export function formatDiagnostics(file: string, diagnostics: LspDiagnosticView[]): string {
  const header = `diagnostics: ${diagnostics.length} in ${file}`;
  if (diagnostics.length === 0) return header;
  const lines = diagnostics.map((item) => {
    const source = item.source ? ` (${item.source})` : "";
    return `${item.severity} ${item.file}:${item.line}:${item.character}: ${item.message}${source}`;
  });
  return [header, ...lines].join("\n");
}

export function formatSymbols(file: string, symbols: LspSymbol[]): string {
  const header = `symbols: ${symbols.length} in ${file}`;
  if (symbols.length === 0) return header;
  return [
    header,
    ...symbols.map(
      (item) => `${item.kind} ${item.name} at ${item.file}:${item.line}:${item.character}`,
    ),
  ].join("\n");
}

export function formatRename(edits: LspTextEdit[]): string {
  const header = `rename: ${edits.length} edit${edits.length === 1 ? "" : "s"}`;
  if (edits.length === 0) return `${header}\n(no edits)`;
  return [
    header,
    ...edits.map(
      (item) =>
        `${item.file}:${item.line}:${item.character}-${item.endLine}:${item.endCharacter} -> ${JSON.stringify(item.newText)}`,
    ),
  ].join("\n");
}
