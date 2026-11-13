/** Deterministic child sessions: read once, acknowledge readiness, submit a typed report. */
export async function subagentReply(body, enabled, released) {
  if (!enabled) return undefined;
  const tools = body.tools?.map((tool) => tool.function?.name) ?? [];
  if (tools.includes("task")) return undefined;
  if (tools.includes("submit_report"))
    return {
      calls: [
        {
          id: "report",
          name: "submit_report",
          arguments: {
            summary: "Готов к работе. Файлы не изменялись.",
            files: ["README.md"],
            findings: [],
            openQuestions: [],
          },
        },
      ],
    };
  if (!body.messages?.some((message) => message.role === "tool"))
    return { calls: [{ id: "child-read", name: "read", arguments: { path: "README.md" } }] };
  await released;
  return { text: "Ready." };
}
