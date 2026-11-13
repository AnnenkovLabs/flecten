import { z } from "zod";
import description from "../../../prompts/tool-description-memory.md" with { type: "text" };
import { MemoryCandidateSchema } from "../../core/memory/command";
import { defineTool } from "../types";

export const memoryTool = defineTool({
  name: "memory",
  description: description.trim(),
  // Provider tool schemas require an object root; operation-specific validation lives in runtime.
  schema: MemoryCandidateSchema.partial()
    .extend({
      cues: MemoryCandidateSchema.shape.cues.unwrap().optional(),
      operation: z.enum(["topics", "list", "read", "sources", "save", "forget", "reconcile"]),
      id: z.string().min(1).max(160).optional(),
      ids: z.array(z.string().min(1).max(160)).min(1).max(6).optional(),
      topic: z.string().min(1).max(64).optional(),
      save: z.array(MemoryCandidateSchema).max(8).optional(),
      forget: z
        .array(
          z
            .object({
              id: z.string().min(1).max(160),
              expectedRevision: z.number().int().positive(),
            })
            .strict(),
        )
        .max(8)
        .optional(),
      query: z.string().max(160).optional(),
      cursor: z.number().int().nonnegative().optional(),
    })
    .strict(),
  mutating: true,
  execute: async (args, context) =>
    context.memory
      ? context.memory.execute(args)
      : {
          ok: false,
          output: "",
          error: "Project memory is not available in this execution scope.",
        },
});
