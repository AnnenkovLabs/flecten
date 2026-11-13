import { z } from "zod";
import { defineTool, type ToolContext } from "../tools/types";

const WorkerRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("start"), task: z.string().min(1).max(60_000) }),
  z.object({ operation: z.literal("steer"), message: z.string().min(1).max(30_000) }),
  z.object({ operation: z.literal("status") }),
  z.object({ operation: z.literal("stop") }),
]);
export type WorkerRequest = z.infer<typeof WorkerRequestSchema>;

export function workerTool(
  execute: (request: WorkerRequest, context: ToolContext) => Promise<unknown>,
) {
  return defineTool({
    name: "worker",
    description:
      "Start an independent persistent Worker with an English task, steer it, inspect its status, or stop it immediately. Start returns immediately; live updates arrive automatically. Only one task can run at a time.",
    schema: WorkerRequestSchema,
    mutating: true,
    async execute(request, context) {
      const data = await execute(request, context);
      return { ok: true, output: JSON.stringify(data), data };
    },
  });
}
