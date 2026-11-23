import { z } from "zod";
import { ExpectedOutputSchema } from "./outputs";

export const bashSpec = {
  name: "bash",
  description:
    "Run a shell command in a fresh Bash process for builds, tests, git, package managers and runtime checks. Foreground calls run sequentially with workspace snapshots; prefer grep (symbol-ranked, AST-expanded, BM25-backed), glob and read over shell rg, grep, find, ls, cat, head, tail or sed, and edit, write or apply_patch over shell file rewrites. Set cwd instead of relying on cd from earlier calls; shell state does not persist. TMPDIR and FLECTEN_SCRATCH identify session scratch, shared across calls, jobs and restarts. Use FLECTEN_SCRATCH paths for files also read by file tools. Returns command exit status and duration; a zero exit is not verification of expected files. Set expectedOutputs to verify artifacts. Foreground timeout kills the process tree. Set background=true for servers or long builds, then use jobs; a job id means started. Use terminal for interactive stdin or persistent shell state.",
  schema: z
    .object({
      command: z.string().min(1).describe("Bash command; quote paths and arguments for the shell"),
      cwd: z
        .string()
        .optional()
        .describe("Working directory, relative to the project or absolute; default project root"),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(600_000)
        .optional()
        .describe("Timeout in milliseconds"),
      background: z
        .boolean()
        .optional()
        .describe(
          "Run as a background job and return its id at once; manage it with the jobs tool",
        ),
      expectedOutputs: z
        .array(ExpectedOutputSchema)
        .max(30)
        .optional()
        .describe("Foreground only: required output files checked after a zero exit"),
    })
    .strict()
    .superRefine((args, context) => {
      if (args.background && args.expectedOutputs?.length)
        context.addIssue({
          code: "custom",
          path: ["expectedOutputs"],
          message:
            "Output verification requires a foreground command; run a verification command after the job finishes.",
        });
    }),
};

export type BashArgs = z.infer<typeof bashSpec.schema>;
