import { z } from "zod";

export const askOptionSchema = z.union([
  z.string().min(1),
  z
    .object({
      label: z.string().min(1).describe("Short option label"),
      description: z.string().optional().describe("What choosing this option means"),
    })
    .strict(),
]);

export const askSpec = {
  name: "ask",
  description:
    "Present a structured question when missing information materially changes the work. Returns immediately after displaying the question; it does not return the user's answer or approval. Continue independent work, but do not act on an assumed answer or treat elapsed time as consent. Prefer a reasonable default for reversible implementation choices. Provide clear options, or an empty options array for a free-form answer.",
  schema: z
    .object({
      question: z.string().min(1).describe("Question to show the user"),
      options: z.array(askOptionSchema).describe("Selectable answers; may be empty for free-form"),
      allowCustom: z
        .boolean()
        .optional()
        .describe("Allow an answer that is not one of the listed options"),
    })
    .strict(),
};

export type AskArgs = z.infer<typeof askSpec.schema>;
export type AskOption = z.infer<typeof askOptionSchema>;
