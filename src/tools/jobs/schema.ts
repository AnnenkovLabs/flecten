import { z } from "zod";
import { RemoteTargetSchema } from "./remote-schema";

export const jobsSpec = {
  name: "jobs",
  description:
    "Inspect local jobs started with bash background=true, or submit a detached Linux remote job through an explicit SSH target and argv. Remote handles are saved before submission and survive reconnects; status reconciles the same PID/start identity and atomic exit record. Reuse a saved remote id after transport failure; never resubmit the workload blindly. list includes saved remote handles, output reads bounded logs, wait is bounded, stop targets the owned process group. Local jobs notify automatically; remote jobs require status/wait. A started handle is not verified success.",
  schema: z
    .object({
      op: z
        .enum(["list", "submit", "status", "output", "wait", "stop"])
        .describe("Operation. Remote submit uses argv and remote; its id survives reconnects."),
      remote: RemoteTargetSchema.optional().describe(
        "Explicit SSH target for submit. Credentials stay with the host SSH agent.",
      ),
      argv: z
        .array(z.string().refine((word) => !word.includes("\0")))
        .min(1)
        .max(1000)
        .optional()
        .describe("Remote submit: executable and arguments, without shell interpolation"),
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
      if (args.op !== "list" && args.op !== "submit" && args.id === undefined) {
        context.addIssue({ code: "custom", path: ["id"], message: `${args.op} needs id` });
      }
      if (args.op === "submit" && (!args.remote || !args.argv))
        context.addIssue({ code: "custom", message: "Remote submit requires remote and argv" });
      if (args.op !== "submit" && (args.remote || args.argv))
        context.addIssue({
          code: "custom",
          message: "remote and argv are only valid for submit; other operations use the saved id",
        });
    }),
};

export type JobsArgs = z.infer<typeof jobsSpec.schema>;
