import { z } from "zod";

export const globSpec = {
  name: "glob",
  description:
    "Find files by path pattern, not file contents. Returns sorted paths relative to the project and respects .gitignore. Patterns without a slash match at any depth. Set hidden=true to include dotfiles and hidden directories; .git and generated/internal directories remain excluded. Use grep to search contents and read to inspect a result.",
  schema: z
    .object({
      pattern: z.string().min(1).describe("Glob pattern, for example **/*.ts"),
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
