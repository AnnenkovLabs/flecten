import { z } from "zod";

/** Durable dialogue of the user's representative with the Worker. */
export const TwinActivitySchema = z.object({
  taskId: z.string().optional(),
  phase: z.enum(["prepare", "checkpoint", "final", "question"]),
  state: z.enum([
    "running",
    "pass",
    "revise",
    "ask_user",
    "error",
    "cancelled",
    "exhausted",
    "disabled",
  ]),
  emotion: z.enum(["calm", "pleased", "angry", "furious"]),
  voice: z.string().max(4000),
  instructions: z.string().max(8000),
  entryIds: z.array(z.string()).max(32),
  corrections: z.number().int().min(0).max(4),
  provider: z.string(),
  model: z.string(),
  usage: z
    .object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cached: z.number().nonnegative(),
      costUsd: z.number().nonnegative().optional(),
    })
    .optional(),
});
export type TwinActivity = z.infer<typeof TwinActivitySchema>;
export type TwinActivityEvent = {
  type: "twin.activity";
  sessionId: string;
  activity: TwinActivity;
};
