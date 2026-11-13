import { z } from "zod";

export const applyPatchSpec = {
  name: "apply_patch",
  description:
    "Apply a Codex-style patch to one or more files in one transaction. The patch starts with *** Begin Patch and ends with *** End Patch. File sections are *** Add File: path, *** Update File: path (optionally followed by *** Move to: path) and *** Delete File: path. Each update hunk starts with @@ and every hunk line starts with a space, + or -. All hunks are validated against the current files before anything is written, so one bad hunk changes nothing. Returns a diff summary and a checkpoint id when checkpoints are enabled.",
  schema: z
    .object({
      patch: z.string().min(1).describe("Complete patch text in the Codex patch format"),
      why: z.string().optional().describe("Reason for changing files outside the project"),
    })
    .strict(),
};

export type ApplyPatchArgs = z.infer<typeof applyPatchSpec.schema>;
