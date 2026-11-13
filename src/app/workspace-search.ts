import { z } from "zod";
import { previewFile } from "./file-preview";
import { listWorkspaceFiles } from "./workspace";

export const SearchOptions = z.object({
  query: z.string().min(1).max(1000),
  caseSensitive: z.boolean().default(false),
  wholeWord: z.boolean().default(false),
  include: z.string().max(1000).default(""),
});
export interface WorkspaceMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  length: number;
}
export const word = (char: string | undefined): boolean =>
  !!char &&
  (char.toLocaleLowerCase() !== char.toLocaleUpperCase() ||
    (char >= "0" && char <= "9") ||
    char === "_");

/** Case conversion may expand a character. Keep matches anchored to original text boundaries. */
export function* literalMatches(
  text: string,
  options: z.infer<typeof SearchOptions>,
): Generator<{ from: number; to: number }> {
  let haystack = text;
  let query = options.query;
  const offsets = [0];
  if (!options.caseSensitive) {
    const chunks: string[] = [];
    let original = 0;
    for (const char of text) {
      const lower = char.toLowerCase();
      chunks.push(lower);
      original += char.length;
      for (let i = 1; i <= lower.length; i += 1) offsets.push(i === lower.length ? original : -1);
    }
    haystack = chunks.join("");
    query = Array.from(query, (char) => char.toLowerCase()).join("");
  }
  let next = 0;
  while (next <= haystack.length) {
    const at = haystack.indexOf(query, next);
    if (at < 0) return;
    next = at + query.length;
    const from = options.caseSensitive ? at : (offsets[at] ?? -1);
    const to = options.caseSensitive ? next : (offsets[next] ?? -1);
    if (from < 0 || to < 0) continue;
    if (options.wholeWord && (word(text[from - 1]) || word(text[to]))) continue;
    yield { from, to };
  }
}

/** Literal search uses the same bounded, redacted file boundary as the editor. */
export async function searchWorkspace(
  cwd: string,
  input: unknown,
): Promise<{ matches: WorkspaceMatch[]; limited: boolean; filesSearched: number }> {
  const options = SearchOptions.parse(input);
  const matches: WorkspaceMatch[] = [];
  const deadline = Date.now() + 5000;
  let filesSearched = 0;
  let limited = false;
  // ponytail: bounded scan of the file index; use an indexed search service for larger workspaces.
  for (const path of await listWorkspaceFiles(cwd)) {
    if (Date.now() > deadline || matches.length >= 500) {
      limited = true;
      break;
    }
    if (options.include && !path.toLocaleLowerCase().includes(options.include.toLocaleLowerCase()))
      continue;
    const file = await previewFile(cwd, path).catch(() => null);
    if (!file || file.binary) continue;
    filesSearched += 1;
    if (file.truncated) limited = true;
    for (const [index, text] of file.text.split("\n").entries()) {
      for (const match of literalMatches(text, options)) {
        matches.push({
          path,
          line: index + 1,
          column: match.from + 1,
          text: text.slice(Math.max(0, match.from - 80), match.to + 160),
          length: match.to - match.from,
        });
        if (matches.length >= 500) {
          limited = true;
          break;
        }
      }
      if (matches.length >= 500) break;
    }
  }
  return { matches, limited, filesSearched };
}
