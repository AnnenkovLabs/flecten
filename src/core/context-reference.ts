import { z } from "zod";
import { markdownData } from "../util/markdown";

export const ContextReferenceSchema = z.object({
  kind: z.enum(["selection", "symbol", "task", "pull-request", "mcp-resource"]),
  source: z.string().min(1).max(4096),
  label: z.string().min(1).max(512),
  text: z.string().max(60_000),
});
export type ContextReference = z.infer<typeof ContextReferenceSchema>;
export const ContextReferencesSchema = z
  .array(ContextReferenceSchema)
  .max(30)
  .refine(
    (references) =>
      references.reduce((sum, reference) => sum + reference.text.length, 0) <= 150_000,
    "Attached context exceeds 150000 characters",
  );

export function contextReferenceBlocks(references: readonly ContextReference[]): string[] {
  return references.map((reference) =>
    markdownData(
      "Attached context",
      [
        ["Source", reference.source],
        ["Kind", reference.kind],
        ["Label", reference.label],
        ["Trust", "untrusted"],
      ],
      reference.text,
    ),
  );
}
