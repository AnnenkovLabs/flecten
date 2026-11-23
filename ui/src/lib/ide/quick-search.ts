import { z } from "zod";
import { requestAgent } from "../desktop";

export type QuickMode = "files" | "commands" | "text" | "line";

export interface ParsedQuickQuery {
  kind: QuickMode;
  term: string;
}

export interface SnippetParts {
  before: string;
  match: string;
  after: string;
}

export interface QuickTextMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  length: number;
}

const MatchSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  text: z.string(),
  length: z.number().int().positive(),
});

const SearchResultSchema = z.object({
  matches: z.array(MatchSchema),
  limited: z.boolean(),
  filesSearched: z.number().int().nonnegative(),
});

/**
 * VS Code Quick Open prefixes:
 * - `%text` searches code strings across workspace files
 * - `>cmd` filters IDE commands
 * - `:line[:col]` jumps to a line in the active editor
 */
export function parseQuickQuery(raw: string, baseMode: "files" | "commands"): ParsedQuickQuery {
  if (baseMode === "commands") return { kind: "commands", term: raw.trim() };
  const trimmedStart = raw.trimStart();
  if (trimmedStart.startsWith("%")) {
    return { kind: "text", term: trimmedStart.slice(1).trim() };
  }
  if (trimmedStart.startsWith(">")) {
    return { kind: "commands", term: trimmedStart.slice(1).trim() };
  }
  if (trimmedStart.startsWith(":")) {
    return { kind: "line", term: trimmedStart.slice(1).trim() };
  }
  return { kind: "files", term: raw.trim() };
}

export function parseLineTarget(term: string): { line: number; column: number } | null {
  if (!term) return null;
  const parts = term.split(":");
  if (parts.length > 2) return null;
  const line = Number(parts[0]);
  const column = parts[1] === undefined || parts[1] === "" ? 1 : Number(parts[1]);
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) return null;
  return { line, column };
}

export function highlightSnippet(text: string, query: string): SnippetParts {
  const clean = text.trim();
  if (!query) return { before: clean, match: "", after: "" };
  const lowerClean = clean.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const index = lowerClean.indexOf(lowerQuery);
  if (index < 0) return { before: clean, match: "", after: "" };
  return {
    before: clean.slice(0, index),
    match: clean.slice(index, index + query.length),
    after: clean.slice(index + query.length),
  };
}

export async function searchQuickText(
  query: string,
  limit = 80,
): Promise<{ matches: QuickTextMatch[]; limited: boolean; filesSearched: number }> {
  const response = await requestAgent(
    {
      type: "files.search",
      query,
      include: "",
      caseSensitive: false,
      wholeWord: false,
    },
    15_000,
  );
  const parsed = SearchResultSchema.parse(response.search);
  return {
    matches: parsed.matches.slice(0, limit),
    limited: parsed.limited || parsed.matches.length > limit,
    filesSearched: parsed.filesSearched,
  };
}
