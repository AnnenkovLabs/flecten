import { z } from "zod";

export const gitOperations = ["status", "diff", "log", "show", "branch", "commit"] as const;

export type GitOperation = (typeof gitOperations)[number];

export const gitSpec = {
  name: "git",
  description:
    "Inspect Git status, diff, log, show or local branches. These operations do not mutate the repository. commit commits the existing staged changes and requires allowCommit=true plus a message; inspect the staged diff and obtain user authorization before committing. The flag records intent and does not grant authorization. This tool never stages files, amends, pushes, rebases or resets.",
  schema: z
    .object({
      operation: z.enum(gitOperations).describe("Git operation to run"),
      staged: z.boolean().optional().describe("diff: show staged changes instead of the worktree"),
      path: z.string().min(1).optional().describe("diff and show: limit output to this path"),
      maxLines: z
        .number()
        .int()
        .positive()
        .max(5000)
        .optional()
        .describe("diff: maximum output lines, default 400"),
      maxCount: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .describe("log: number of commits, default 20"),
      rev: z.string().min(1).optional().describe("show: revision, default HEAD"),
      message: z.string().min(1).optional().describe("commit: commit message"),
      allowCommit: z
        .boolean()
        .optional()
        .describe("commit: must be true only after the user authorizes committing staged changes"),
    })
    .strict(),
};

export type GitArgs = z.infer<typeof gitSpec.schema>;
