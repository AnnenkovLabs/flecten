import { z } from "zod";
import type { MessageKey } from "./i18n/catalogs";
import { t } from "./i18n.svelte";

const finding = z.union([
  z.string(),
  z.object({
    message: z.string(),
    severity: z.enum(["low", "medium", "high"]),
    file: z.string().optional(),
    line: z.number().int().positive().optional(),
  }),
]);
const reportSchema = z.object({
  kind: z.literal("subagent"),
  data: z.object({
    summary: z.string().optional(),
    verdict: z.enum(["pass", "fail"]).optional(),
    findings: z.array(finding).optional(),
    files: z.array(z.string()).optional(),
    filesChanged: z.array(z.string()).optional(),
    testsRun: z.array(z.string()).optional(),
    blockers: z.array(z.string()).optional(),
    evidence: z.array(z.string()).optional(),
    openQuestions: z.array(z.string()).optional(),
  }),
});

export function subagentReport(value: unknown) {
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const data = parsed.data.data;
  const severity: Record<"low" | "medium" | "high", MessageKey> = {
    low: "Low severity",
    medium: "Medium severity",
    high: "High severity",
  };
  const sections: { label: MessageKey; items: string[] }[] = [
    {
      label: "Findings",
      items: (data.findings ?? []).map((item) =>
        typeof item === "string"
          ? item
          : `${t(severity[item.severity])}: ${item.file ? `${item.file}${item.line ? `:${item.line}` : ""}: ` : ""}${item.message}`,
      ),
    },
    { label: "Files", items: data.files ?? [] },
    { label: "Changed files", items: data.filesChanged ?? [] },
    { label: "Checks run", items: data.testsRun ?? [] },
    { label: "Blockers", items: data.blockers ?? [] },
    { label: "Evidence", items: data.evidence ?? [] },
    { label: "Open questions", items: data.openQuestions ?? [] },
  ];
  if (!data.summary && !data.verdict && sections.every((section) => section.items.length === 0))
    return undefined;
  return {
    summary: data.summary,
    verdict: data.verdict,
    sections: sections.filter((section) => section.items.length > 0),
  };
}
