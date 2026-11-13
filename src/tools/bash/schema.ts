import { z } from "zod";

export const bashSpec = {
  name: "bash",
  description:
    "Run a shell command in a fresh Bash process for builds, tests and command-line tools. Use read, grep and glob for file inspection and edit, write or apply_patch for file changes. Set cwd instead of relying on cd from earlier calls; shell state does not persist. Returns stdout/stderr in arrival order, exit code and duration; a nonzero exit is a failed result. Foreground timeout kills the process tree. Set background=true for servers, watchers or long builds, then use jobs; a returned job id means started, not passed. Use terminal for interactive stdin or persistent shell state.",
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
    })
    .strict(),
};

export type BashArgs = z.infer<typeof bashSpec.schema>;
