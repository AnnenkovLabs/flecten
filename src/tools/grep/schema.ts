import { z } from "zod";

export const grepSpec = {
  name: "grep",
  description:
    "Code-aware content search backed by ripgrep (prefer over bash/terminal rg or grep). Ranks symbol definitions and source files above call sites, tests and docs, auto-expands compact matching definitions, prepends enclosing function or class signatures when context>0, and falls back to multi-term BM25 identifier search when a regex has no exact hit (set literal=true for exact text without regex or BM25 fallback). Runs in parallel with glob and read, respects .gitignore, and records matched files so edit works without a separate read. Returns matching lines with paths and 1-based line numbers; count returns per-file counts and filesWithMatches returns paths only. Narrow path, glob or type before raising maxResults.",
  schema: z
    .object({
      pattern: z
        .string()
        .min(1)
        .describe(
          "Regular expression, multi-term identifier query (BM25 fallback on zero exact hits), or exact text when literal=true",
        ),
      literal: z
        .boolean()
        .optional()
        .describe("Exact substring search without regex syntax or BM25 fallback; default false"),
      path: z.string().optional().describe("Directory or file to search; default project root"),
      glob: z.string().optional().describe("File glob filter, for example *.ts"),
      type: z.string().min(1).optional().describe("File type filter, for example ts, py, rust"),
      caseSensitive: z
        .boolean()
        .optional()
        .describe("Match case exactly; defaults to true. Set false to ignore case"),
      multiline: z
        .boolean()
        .optional()
        .describe("Allow patterns to match across line breaks; default false"),
      context: z
        .number()
        .int()
        .nonnegative()
        .max(20)
        .optional()
        .describe(
          "Context lines around each match (also prepends enclosing symbol signature); omit to auto-expand top compact definitions",
        ),
      hidden: z.boolean().optional().describe("Include hidden files and directories"),
      count: z.boolean().optional().describe("Return matching-line counts per file"),
      filesWithMatches: z
        .boolean()
        .optional()
        .describe("Return paths only; takes precedence over count"),
      maxResults: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe("Maximum matching lines, or files in count/path mode; default 200"),
    })
    .strict(),
};

export type GrepArgs = z.infer<typeof grepSpec.schema>;
