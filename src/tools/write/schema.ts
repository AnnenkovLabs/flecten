import { z } from "zod";

export const writeSpec = {
  name: "write",
  description:
    "Create a text file or replace its complete contents. Parent directories are created automatically. Read an existing file first; overwrites are rejected if it is unread or changed since reading. Prefer edit for a targeted replacement and apply_patch for coordinated file changes. Pass why for a path outside the project; this does not grant permission.",
  schema: z
    .object({
      path: z.string().min(1).describe("File path, relative to the project or absolute"),
      content: z.string().describe("Complete file content"),
      why: z.string().optional().describe("Reason for writing outside the project"),
    })
    .strict(),
};

export type WriteArgs = z.infer<typeof writeSpec.schema>;
