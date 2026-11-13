import { z } from "zod";

export const readSpec = {
  name: "read",
  description:
    "Read images (PNG, JPEG, WebP, GIF, AVIF) or text files with 1-based line numbers. Use glob to find paths and grep to locate relevant sections before reading large files. Read existing files before edit or write; reread if a tool reports that the file changed. offset and limit select a line range, and truncation footers explain how to continue. Displayed line-number prefixes are not part of the file. Images are returned visually or described by the configured vision model. Directories and other binary files are rejected.",
  schema: z
    .object({
      focus: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe("For images only: what to inspect closely or a specific question to answer"),
      path: z.string().min(1).describe("File path, relative to the project or absolute"),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("1-based first line; 0 is treated as 1"),
      limit: z
        .number()
        .int()
        .nonnegative()
        .max(10_000)
        .optional()
        .describe("Maximum lines to read; uses the session read limit when omitted or zero"),
    })
    .strict(),
};

export type ReadArgs = z.infer<typeof readSpec.schema>;
