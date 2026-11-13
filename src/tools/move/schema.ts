import { z } from "zod";

export const moveSpec = {
  name: "move",
  description:
    "Rename a file within the project. Refuses to overwrite an existing destination unless overwrite is true. A checkpoint is captured before the rename. Pass why when a path is outside the project.",
  schema: z
    .object({
      from: z.string().min(1).describe("Current file path, relative to the project or absolute"),
      to: z.string().min(1).describe("New file path, relative to the project or absolute"),
      overwrite: z
        .boolean()
        .optional()
        .describe("Replace the destination file if it already exists"),
      why: z.string().optional().describe("Reason for moving files outside the project"),
    })
    .strict(),
};

export type MoveArgs = z.infer<typeof moveSpec.schema>;
