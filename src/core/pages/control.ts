import { z } from "zod";
import { PageReadSchema, PageSearchSchema } from "./archive";

export const ActivePageSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(2000),
  })
  .strict();

const begin = ActivePageSchema.extend({ op: z.literal("begin") });
const report = z
  .object({
    summary: z.string().trim().min(1).max(8000),
    evidence: z.array(z.string().trim().min(1).max(2000)).min(1).max(20),
    next: z.string().trim().min(1).max(4000),
  })
  .strict();
const complete = report.extend({ op: z.literal("complete") });
const block = report.extend({ op: z.literal("block") });

export const PageCommandSchema = z.discriminatedUnion("op", [
  begin,
  complete,
  block,
  z.object({ op: z.literal("list") }).strict(),
  PageReadSchema.extend({ op: z.literal("read") }),
  PageSearchSchema.extend({ op: z.literal("search") }),
]);

// Provider schemas require an object root; the runtime validates each operation separately.
export const PageToolSchema = z
  .object({
    op: z.enum(["begin", "complete", "block", "list", "read", "search"]),
    ...ActivePageSchema.partial().shape,
    ...complete.omit({ op: true }).partial().shape,
    ...PageReadSchema.partial().shape,
    query: PageSearchSchema.shape.query.optional(),
  })
  .strict();

export type ActivePage = z.infer<typeof ActivePageSchema>;
export type PageReport = z.infer<typeof report>;
export type PageCommand = z.infer<typeof PageCommandSchema>;
