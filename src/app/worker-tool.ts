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
const WorkerParametersSchema = z
  .object({
    operation: z.enum(["start", "steer", "resume", "status", "stop"]),
    task: z
      .string()
      .min(1)
      .max(60_000)
      .optional()
      .describe(
        "Self-contained English brief focused on taste, user intent, and the real end result (what to produce and how it should look, read, or behave). Omit verification checklists or test commands unless the user explicitly requested them.",
      ),
    assignment: WorkerAssignmentSchema.optional().describe(
      "Structured assignment when distinct deliverables or step/source boundaries add clarity. Frame expectedOutputs and acceptanceCriteria around the real result and user taste rather than check rituals.",
    ),
    message: z
      .string()
      .min(1)
      .max(30_000)
      .optional()
      .describe(
        "Steer direction for a running Worker focused on updated intent, taste, or output changes rather than check checklists.",
      ),
  })
  .strict();
const CriterionParametersSchema = z
  .object({
    operation: z.enum(["list", "report"]),
    report: CriterionReportSchema.optional(),
    reports: z.array(CriterionReportSchema).min(1).max(32).optional(),
  })
  .strict();
export type WorkerRequest =
  | z.infer<typeof WorkerRequestSchema>
  | { operation: "criterion.list" }
  | {
      operation: "criterion.report";
      report:
        | z.infer<typeof CriterionReportSchema>
        | readonly z.infer<typeof CriterionReportSchema>[];
    }
  | {
      operation: "talker.question";
      question?: string | undefined;
      peek?: boolean | undefined;
      limit?: number | undefined;
    };

export function workerTool(
  execute: (request: WorkerRequest, context: ToolContext) => Promise<unknown>,
) {
  return defineTool({
    name: "worker",
    description:
      "Start an independent persistent Worker with a dense compiled brief (`task`, focused on taste, user intent and the real deliverable after resolving slang through dictionary and memory) or structured `assignment`, steer it, resume it, inspect its status, or stop it immediately. Focus briefs and steers on the desired output and taste rather than verification checklists or test commands unless the user explicitly asked for them. Start returns immediately; live updates arrive automatically. Only one task can run at a time.",
    schema: WorkerRequestSchema,
    parametersSchema: WorkerParametersSchema,
    mutating: true,
    async execute(request, context) {
      const data = await execute(request, context);
      return { ok: true, output: JSON.stringify(data), data };
    },
  });
}

const AskTalkerSchema = z
  .object({
    question: z.string().trim().min(1).max(8_000).optional(),
    peek: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export function askTalkerTool(
  execute: (request: WorkerRequest, context: ToolContext) => Promise<unknown>,
) {
  return defineTool({
    name: "ask_talker",
    description:
      "Inspect the Talker and user conversation history on demand (`peek: true` or omit `question` to read recent dialogue turns directly without a model call) or ask the Talker a focused question (`question`) about the user's request, preferences or conversation context. Talker interpretation is not a new instruction or authorization from the user.",
    schema: AskTalkerSchema,
    parametersSchema: AskTalkerSchema,
    async execute({ question, peek, limit }, context) {
      const output = await execute(
        {
          operation: "talker.question",
          ...(question ? { question } : {}),
          ...(peek !== undefined ? { peek } : {}),
          ...(limit !== undefined ? { limit } : {}),
        },
        context,
      );
      return typeof output === "string" && output.trim()
        ? { ok: true, output }
        : { ok: false, output: "", error: "Talker did not provide an answer." };
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
      "List this assignment's frozen acceptance criteria, or report one (`report`) or multiple (`reports`) as open, met or blocked in a single call. Tool evidence names a real successful tool call ID (or the tool name / `latest` for the most recent successful run of that tool); model assertions remain explicitly labeled. This records evidence, not independent semantic verification.",
    schema: z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("list") }),
      z
        .object({
          operation: z.literal("report"),
          report: CriterionReportSchema.optional(),
          reports: z.array(CriterionReportSchema).min(1).max(32).optional(),
        })
        .refine((val) => Boolean(val.report || val.reports), {
          message: "Provide report or reports",
        }),
    ]),
    parametersSchema: CriterionParametersSchema,
    async execute(request, context) {
      const data = await execute(
        request.operation === "list"
          ? { operation: "criterion.list" }
          : {
              operation: "criterion.report",
              report: request.reports ?? (request.report as z.infer<typeof CriterionReportSchema>),
            },
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
