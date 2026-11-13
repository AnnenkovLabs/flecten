import { z } from "zod";

export const taskSpec = {
  name: "task",
  description:
    "Delegate a bounded task to a registered subagent and wait for its result. Each child has a persistent id, isolated context, tools and budget, and shares the workspace. Children keep running when the parent run stops. Use operation=list to inspect them, wait with id to collect a report, or stop with id to cancel one explicitly. Pass the objective, paths, constraints and evidence explicitly. Give parallel writers disjoint files. Reports are claims to assess, not proof of unreported checks.",
  schema: z
    .object({
      operation: z.enum(["run", "list", "wait", "stop"]).optional(),
      id: z
        .string()
        .min(1)
        .optional()
        .describe("Subagent id returned by run or list; required for wait and stop"),
      agent: z
        .string()
        .min(1)
        .optional()
        .describe("Exact registered subagent id from the available catalog; required for run"),
      prompt: z
        .string()
        .min(1)
        .optional()
        .describe("Self-contained task: objective, scope, constraints and required result"),
      context: z
        .string()
        .optional()
        .describe("Background supplied explicitly to the isolated child"),
    })
    .strict()
    .superRefine((input, context) => {
      const operation = input.operation ?? "run";
      const required =
        operation === "run"
          ? (["agent", "prompt"] as const)
          : operation === "list"
            ? []
            : (["id"] as const);
      for (const key of required)
        if (!input[key])
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required for ${operation}`,
          });
    }),
};

export type TaskArgs = z.infer<typeof taskSpec.schema>;
