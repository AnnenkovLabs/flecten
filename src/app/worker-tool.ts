import { z } from "zod";
import { CriterionReportSchema, WorkerAssignmentSchema } from "../../shared/worker-assignment";
import { defineTool, type ToolContext } from "../tools/types";

const WorkerRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("start"),
    task: z.string().min(1).max(60_000).optional(),
    assignment: WorkerAssignmentSchema.optional(),
  }),
  z.object({ operation: z.literal("steer"), message: z.string().min(1).max(30_000) }),
  z.object({ operation: z.literal("resume") }),
  z.object({ operation: z.literal("status") }),
  z.object({ operation: z.literal("stop") }),
]);
export type WorkerRequest =
  | z.infer<typeof WorkerRequestSchema>
  | { operation: "criterion.list" }
  | { operation: "criterion.report"; report: z.infer<typeof CriterionReportSchema> };

export function workerTool(
  execute: (request: WorkerRequest, context: ToolContext) => Promise<unknown>,
) {
  return defineTool({
    name: "worker",
    description:
      "Start an independent persistent Worker with an explicit assignment, steer it, inspect its status and acceptance ledger, or stop it immediately. Start returns immediately; live updates arrive automatically. Only one task can run at a time. The legacy task string is supported; use assignment to preserve constraints, outputs and individual acceptance criteria.",
    schema: WorkerRequestSchema,
    mutating: true,
    async execute(request, context) {
      const data = await execute(request, context);
      return { ok: true, output: JSON.stringify(data), data };
    },
  });
}

/** The Worker reports evidence; it cannot change the assignment or control another execution. */
export function criterionTool(
  execute: (request: WorkerRequest, context: ToolContext) => Promise<unknown>,
) {
  return defineTool({
    name: "criterion",
    description:
      "List this assignment's frozen acceptance criteria, or report one open, met or blocked. Tool evidence names a real successful tool call ID; model assertions remain explicitly labeled. This records evidence, not independent semantic verification.",
    schema: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("list") }),
      z.object({ operation: z.literal("report"), report: CriterionReportSchema }),
    ]),
    async execute(request, context) {
      const data = await execute(
        request.operation === "list"
          ? { operation: "criterion.list" }
          : { operation: "criterion.report", report: request.report },
        context,
      );
      const state = data as import("../../shared/worker-assignment").WorkerAcceptance | undefined;
      const ledger = state?.criteria
        ? state.criteria
            .map((criterion) => {
              const definition = state.assignment.acceptanceCriteria.find(
                ({ id }) => id === criterion.id,
              );
              return `- ${criterion.id}: ${criterion.status}. ${definition?.description}\n  Required evidence: ${definition?.evidenceRequirement}${criterion.evidence ? `\n  Evidence (${criterion.evidence.kind}): ${criterion.evidence.statement}` : `\n  ${criterion.reason ?? "Evidence pending."}`}`;
            })
            .join("\n")
        : "No active assignment.";
      const output =
        request.operation === "list" && state?.assignment
          ? [
              `# Objective\n${state.assignment.objective}`,
              `# User constraints (verbatim)\n${state.assignment.userConstraints.join("\n")}`,
              `# Expected outputs\n${state.assignment.expectedOutputs.join("\n")}`,
              ...(state.assignment.currentStep
                ? [`# Current step\n${state.assignment.currentStep}`]
                : []),
              ...(state.assignment.questions?.length
                ? [`# Questions to answer\n${state.assignment.questions.join("\n")}`]
                : []),
              ...(state.assignment.sourceScope?.length
                ? [`# Source scope\n${state.assignment.sourceScope.join("\n")}`]
                : []),
              ...(state.assignment.sufficiency?.length
                ? [`# Sufficient result\n${state.assignment.sufficiency.join("\n")}`]
                : []),
              `# Acceptance criteria\n${ledger}`,
            ].join("\n\n")
          : ledger;
      return { ok: true, output, data };
    },
  });
}
