import { z } from "zod";
import { ModelChoiceSchema } from "../../shared/model-choice";

export const VisionConfigSchema = z.object({
  /** Empty provider follows the working model's provider; empty model selects by price. */
  provider: z.string().default(""),
  model: z.string().default(""),
  reasoning: ModelChoiceSchema.shape.reasoning,
  variant: ModelChoiceSchema.shape.variant,
});
