import { z } from "zod";

export const deleteSpec = {
  name: "delete",
  description:
    "Delete a file or an empty directory. Pass recursive: true to delete a non-empty directory. A checkpoint is captured before deletion so the change can be undone. Pass why when the path is outside the project.",
  schema: z
    .object({
      path: z
        .string()
        .min(1)
        .describe("File or directory path, relative to the project or absolute"),
      recursive: z
        .boolean()
        .optional()
        .describe("Allow deleting a non-empty directory and everything inside it"),
      why: z.string().optional().describe("Reason for deleting outside the project"),
    })
    .strict(),
};

export type DeleteArgs = z.infer<typeof deleteSpec.schema>;
