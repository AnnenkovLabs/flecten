import type { SubagentSpec } from "./types";

export function parseSubagentResult(
  spec: SubagentSpec,
  text: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `Subagent "${spec.id}" returned text that is not valid JSON.` };
  }
  const result = spec.resultSchema.safeParse(parsed);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .map((issue) =>
      issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
  return { ok: false, error: `Subagent "${spec.id}" returned an invalid result: ${issues}` };
}
