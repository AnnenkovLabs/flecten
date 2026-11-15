import { z } from "zod";

export const ModelChoiceSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoning: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  variant: z.string().min(1).optional(),
});
export type ModelChoice = z.infer<typeof ModelChoiceSchema>;

export const ModelSelectedSchema = ModelChoiceSchema.extend({
  type: z.literal("model.selected"),
  sessionId: z.string().min(1),
});
export type ModelSelected = z.infer<typeof ModelSelectedSchema>;
