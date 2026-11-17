import { z } from "zod";

export const globSpec = {
  name: "glob",
  description:
    "Discover the project with mode=entries first: lists immediate files and directories without recursion. mode=files searches a scoped path by pattern, respects .gitignore, and returns a sorted page with nextOffset. Patterns without a slash match at any depth. Generated dependencies and caches are excluded unless includeGenerated=true; internal metadata stays excluded. Use docs and source directories from the overview before a recursive search. Use grep for contents and read for a result.",
  schema: z
    .object({
      pattern: z.string().min(1).default("*").describe("Glob pattern, for example **/*.ts"),
      mode: z
        .enum(["entries", "files"])
        .optional()
        .describe("entries lists immediate children; files searches recursively"),
      includeGenerated: z
        .boolean()
        .optional()
        .describe("Explicitly include dependency, build and cache directories"),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Result cursor returned as nextOffset"),
      path: z.string().optional().describe("Directory to search; default project root"),
      hidden: z.boolean().optional().describe("Include dotfiles and hidden directories"),
      maxResults: z
        .number()
        .int()
        .positive()
        .max(5000)
        .optional()
        .describe("Maximum file paths returned; default 500"),
    })
    .strict(),
};

export type GlobArgs = z.infer<typeof globSpec.schema>;
