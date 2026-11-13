import { z } from "zod";
import description from "../../../prompts/tool-description-done.md" with { type: "text" };
import { MemoryCandidateSchema } from "../../core/memory/command";

export const doneSpec = {
  name: "done",
  description: description.trim(),
  schema: z
    .object({
      summary: z.string().min(1).describe("What was done"),
      evidence: z.array(z.string().min(1)).min(1).describe("Concrete proof the work is complete"),
      // Definitions use memory.save; repeating its full schema here inflates every request.
      memoryCandidates: MemoryCandidateSchema.omit({ dictionary: true }).array().max(3).optional(),
    })
    .strict(),
};

// Completion is authoritative; optional memory validates inside the protected capture branch.
export const doneExecutionSchema = doneSpec.schema.extend({
  memoryCandidates: z.unknown().optional(),
});
export type DoneArgs = z.infer<typeof doneExecutionSchema>;
