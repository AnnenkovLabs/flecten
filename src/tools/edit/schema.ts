import { z } from "zod";

const editHunk = z
  .object({
    oldString: z.string().min(1).describe("Exact text to replace"),
    newString: z.string().describe("Replacement text"),
    replaceAll: z.boolean().optional().describe("Replace every exact occurrence in this hunk"),
  })
  .strict();

export const editSpec = {
  name: "edit",
  description:
    "Replace exact text in one existing file. Read it first and copy source text without displayed line numbers. Pass either one oldString/newString pair or an edits array of non-overlapping replacements against the same original contents. oldString must match once unless replaceAll=true; add surrounding lines to disambiguate. Empty newString deletes the matched text. Preserves line endings and rejects files changed since reading. Use write for a new file or apply_patch for coordinated changes across files.",
  schema: z
    .object({
      path: z.string().min(1).describe("File path, relative to the project or absolute"),
      oldString: z.string().min(1).optional().describe("Exact text to replace"),
      newString: z.string().optional().describe("Replacement text"),
      replaceAll: z.boolean().optional().describe("Replace every exact occurrence"),
      edits: z
        .array(editHunk)
        .min(1)
        .optional()
        .describe("Several non-overlapping replacements applied together"),
      why: z.string().optional().describe("Reason for editing outside the project"),
    })
    .strict()
    .superRefine((args, context) => {
      const hasSingle = args.oldString !== undefined || args.newString !== undefined;
      if (args.edits && hasSingle) {
        context.addIssue({
          code: "custom",
          message: "Pass either oldString/newString or edits, not both",
          path: ["edits"],
        });
      }
      if (!args.edits && (args.oldString === undefined || args.newString === undefined)) {
        context.addIssue({
          code: "custom",
          message: "oldString and newString are required when edits is not provided",
          path: ["oldString"],
        });
      }
    }),
};

export type EditArgs = z.infer<typeof editSpec.schema>;
export type EditHunk = z.infer<typeof editHunk>;
