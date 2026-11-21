import { z } from "zod";
import { PageReadSchema, PageSearchSchema } from "./archive";

export const ActivePageSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(2000),
  })
  .strict();

const begin = ActivePageSchema.extend({ op: z.literal("begin") });
export const PageReportSchema = z
  .object({
    summary: z.string().trim().min(1).max(8000),
    evidence: z.array(z.string().trim().min(1).max(2000)).min(1).max(20),
    next: z.string().trim().min(1).max(4000),
    findings: z.array(z.string().trim().min(1).max(12000)).max(30).optional(),
    openRisks: z.array(z.string().trim().min(1).max(2000)).max(20).optional(),
    result: z.string().trim().min(1).max(100000).optional(),
  })
  .strict();
const compactOp = z.enum(["compact", "complete"]);

const compact = PageReportSchema.extend({
  op: compactOp,
  title: z.string().trim().min(1).max(200).optional(),
  finalResult: z.string().trim().min(1).max(100000).optional(),
});
const block = PageReportSchema.extend({ op: z.literal("block") });

export const PageCommandSchema = z.discriminatedUnion("op", [
  begin,
  compact,
  block,
  z.object({ op: z.literal("list") }).strict(),
  PageReadSchema.extend({ op: z.literal("read") }),
  PageSearchSchema.extend({ op: z.literal("search") }),
]);

export function parsePageCommand(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== null && entry !== undefined) cleaned[key] = entry;
    }
    if (!("op" in cleaned) && typeof cleaned.summary === "string") {
      cleaned.op = "compact";
    }
    return PageCommandSchema.safeParse(cleaned);
  }
  return PageCommandSchema.safeParse(value);
}

// Provider schemas require an object root; the runtime validates each operation separately.
export const PageToolSchema = z
  .object({
    op: z.enum(["compact", "complete", "begin", "block", "list", "read", "search"]).optional(),
    ...ActivePageSchema.partial().shape,
    ...compact.omit({ op: true }).partial().shape,
    ...PageReadSchema.partial().shape,
    query: PageSearchSchema.shape.query.optional(),
  })
  .strict();

export type ActivePage = z.infer<typeof ActivePageSchema>;
export type PageReport = z.infer<typeof PageReportSchema>;
export type PageCommand = z.infer<typeof PageCommandSchema>;
