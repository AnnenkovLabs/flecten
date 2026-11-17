import { z } from "zod";

const text = z.string().min(1).max(8000);
export const WorkerAssignmentSchema = z
  .object({
    objective: z.string().min(1).max(60_000),
    userConstraints: z.array(text).max(32),
    /** Explicit scope for the current execution; original human input is stored separately. */
    currentStep: text.optional(),
    questions: z.array(text).max(32).optional(),
    sourceScope: z.array(text).max(32).optional(),
    sufficiency: z.array(text).max(32).optional(),
    expectedOutputs: z.array(text).min(1).max(32),
    acceptanceCriteria: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          description: text,
          evidenceRequirement: z.enum(["tool_result", "model_assertion"]),
        }),
      )
      .min(1)
      .max(32),
  })
  .superRefine((assignment, context) => {
    const ids = assignment.acceptanceCriteria.map((criterion) => criterion.id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        path: ["acceptanceCriteria"],
        message: "Criterion IDs must be unique",
      });
    const characters = [
      assignment.objective,
      ...(assignment.currentStep ? [assignment.currentStep] : []),
      ...(assignment.questions ?? []),
      ...(assignment.sourceScope ?? []),
      ...(assignment.sufficiency ?? []),
      ...assignment.userConstraints,
      ...assignment.expectedOutputs,
      ...assignment.acceptanceCriteria.flatMap(({ id, description }) => [id, description]),
    ].reduce((sum, value) => sum + value.length, 0);
    if (characters > 64_000)
      context.addIssue({
        code: "custom",
        message: "The complete assignment must fit within 64000 characters",
      });
  });
export type WorkerAssignment = z.infer<typeof WorkerAssignmentSchema>;

export const CriterionReportSchema = z.object({
  criterionId: z.string().min(1).max(80),
  status: z.enum(["open", "met", "blocked"]),
  evidence: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("tool_result"),
        callId: z.string().min(1).max(200),
        statement: text,
      }),
      z.object({ kind: z.literal("model_assertion"), statement: text }),
    ])
    .optional(),
  reason: text.optional(),
});
export type CriterionReport = z.infer<typeof CriterionReportSchema>;

export const WorkerAcceptanceSchema = z
  .object({
    taskId: z.string().min(1),
    revision: z.number().int().nonnegative().default(0),
    assignment: WorkerAssignmentSchema,
    legacy: z.boolean(),
    phase: z.enum(["running", "reviewing", "accepted", "unconfirmed", "stopped", "error"]),
    directions: z.array(text).max(32),
    criteria: z
      .array(
        z.object({
          id: z.string().min(1).max(80),
          status: z.enum(["open", "met", "blocked"]),
          reason: text.optional(),
          evidence: z
            .object({
              kind: z.enum(["tool_result", "model_assertion"]),
              statement: text,
              callId: z.string().optional(),
              tool: z.string().optional(),
              output: z.string().max(2000).optional(),
            })
            .optional(),
        }),
      )
      .min(1)
      .max(32),
  })
  .superRefine((state, context) => {
    const definitions = new Map(
      state.assignment.acceptanceCriteria.map((criterion) => [criterion.id, criterion]),
    );
    if (
      state.criteria.length !== definitions.size ||
      new Set(state.criteria.map(({ id }) => id)).size !== definitions.size
    )
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "Ledger criteria must match the assignment exactly",
      });
    for (const [index, criterion] of state.criteria.entries()) {
      const definition = definitions.get(criterion.id);
      const evidence = criterion.evidence;
      if (
        !definition ||
        (criterion.status === "met" &&
          (!evidence ||
            (definition.evidenceRequirement === "tool_result" &&
              evidence.kind !== "tool_result"))) ||
        (evidence?.kind === "tool_result" &&
          (!evidence.callId || !evidence.tool || evidence.output === undefined)) ||
        (criterion.status === "blocked" && !criterion.reason)
      )
        context.addIssue({
          code: "custom",
          path: ["criteria", index],
          message: "Criterion status needs the declared evidence or a blocker reason",
        });
    }
    if (state.phase === "accepted" && state.criteria.some(({ status }) => status !== "met"))
      context.addIssue({
        code: "custom",
        path: ["phase"],
        message: "Accepted assignments cannot have open or blocked criteria",
      });
  });
export type WorkerAcceptance = z.infer<typeof WorkerAcceptanceSchema>;
