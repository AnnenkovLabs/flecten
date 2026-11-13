import { z } from "zod";

export const jobsSpec = {
  name: "jobs",
  description:
    "Inspect or control jobs started with bash background=true. list shows ids and states; output returns a log tail or a page from a character offset; wait waits for completion or timeout; stop kills the process tree. Prefer a bounded wait over repeated polling, or continue independent work and use the automatic completion notice. A wait timeout means the job is still running. Verify final status and exit code before claiming success.",
  schema: z
    .object({
      op: z.enum(["list", "output", "wait", "stop"]).describe("Operation"),
      id: z.string().min(1).optional().describe("Job id, as job-1; required except for list"),
      lines: z
        .number()
        .int()
        .positive()
        .max(2000)
        .optional()
        .describe("output and wait: last lines of the log to return, default 80"),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("output: return the log from this character offset instead of the tail"),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(1_800_000)
        .optional()
        .describe("wait: maximum time to wait, default from terminal settings"),
    })
    .strict()
    .superRefine((args, context) => {
      if (args.op !== "list" && args.id === undefined) {
        context.addIssue({ code: "custom", path: ["id"], message: `${args.op} needs id` });
      }
    }),
};

export type JobsArgs = z.infer<typeof jobsSpec.schema>;
