import { z } from "zod";

export const grepSpec = {
  name: "grep",
  description:
    "Search text inside files. Use glob to find paths and read to inspect a matching file. Returns matching lines with paths and 1-based line numbers; count returns matching-line counts per file, and filesWithMatches returns paths only. Searches respect .gitignore. Narrow path, glob or type before raising maxResults. Set literal=true to search exact text without escaping regular-expression characters.",
  schema: z
    .object({
      pattern: z.string().min(1).describe("Regular expression, or exact text when literal=true"),
      literal: z.boolean().optional().describe("Treat pattern as exact text; default false"),
      path: z.string().optional().describe("Directory or file to search; default project root"),
      glob: z.string().optional().describe("File glob filter, for example *.ts"),
      type: z.string().min(1).optional().describe("File type filter, for example ts, py, rust"),
      caseSensitive: z
        .boolean()
        .optional()
        .describe("Match case exactly; defaults to true. Set false to ignore case"),
      context: z
        .number()
        .int()
        .nonnegative()
        .max(20)
        .optional()
        .describe("Lines of context before and after each match"),
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
