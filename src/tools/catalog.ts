import { z } from "zod";
import description from "../../prompts/tool-description-catalog.md" with { type: "text" };
import type { Message } from "../core/types";
import { defineTool, type Tool } from "./types";

export const CATALOG_TOOL = "tool_catalog";
export const CatalogCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("list"),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("activate"),
      names: z.array(z.string().min(1).max(256)).min(1).max(128),
    })
    .strict(),
]);
const NamesSchema = z.array(z.string().min(1).max(256)).max(128);

/** Successful typed calls are durable state. Text from model summaries cannot activate tools. */
export function restoredMcpSelection(messages: readonly Message[]): string[] {
  let names = new Set<string>();
  const calls = new Map<string, z.infer<typeof CatalogCommandSchema>>();
  for (const message of messages) {
    if (message.role === "user" && message.contextSummary) {
      const parsed = NamesSchema.safeParse(message.contextSummary.activeMcpTools);
      names = new Set(parsed.success ? parsed.data : []);
      calls.clear();
    } else if (message.role === "assistant") {
      for (const call of message.toolCalls) {
        if (call.name !== CATALOG_TOOL) continue;
        const parsed = CatalogCommandSchema.safeParse(call.args);
        if (parsed.success) calls.set(call.id, parsed.data);
      }
    } else if (message.role === "tool" && message.name === CATALOG_TOOL) {
      const command = calls.get(message.toolCallId);
      calls.delete(message.toolCallId);
      if (!message.isError && command?.operation === "activate")
        for (const name of command.names) names.add(name);
    }
  }
  return [...names];
}

/** The registry owns activation; execution and authorization of external tools stay unchanged. */
export function catalogTool(tools: readonly Tool[], active: Set<string>): Tool {
  return defineTool({
    name: CATALOG_TOOL,
    description: description.trim(),
    schema: z
      .object({
        operation: z.enum(["list", "activate"]),
        names: z.array(z.string().min(1).max(256)).min(1).max(128).optional(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    async execute(input) {
      const parsed = CatalogCommandSchema.safeParse(input);
      if (!parsed.success) return { ok: false, output: "", error: parsed.error.message };
      if (parsed.data.operation === "activate") {
        const names = parsed.data.names;
        if (names.some((name) => !tools.some((tool) => tool.name === name)))
          return {
            ok: false,
            output: "",
            error: "Unknown external tool. List the catalog and activate its exact name.",
          };
        if (new Set([...active, ...names]).size > 128)
          return {
            ok: false,
            output: "",
            error: "A session can activate at most 128 external tools.",
          };
        for (const name of names) active.add(name);
        return {
          ok: true,
          output: `External tools activated for this session:\n${names.map((name) => `- ${name}`).join("\n")}\nTheir schemas are available on the next request. Execution still requires normal permissions.`,
        };
      }
      const offset = parsed.data.offset ?? 0;
      const limit = parsed.data.limit ?? 20;
      const selected = tools.slice(offset, offset + limit);
      return {
        ok: true,
        output:
          selected
            .map(
              (tool) =>
                `## ${tool.name}\n${tool.description}\nStatus: ${active.has(tool.name) ? "active" : "available"}`,
            )
            .join("\n\n") || "No external tools in this page.",
        data: {
          kind: "tool_catalog",
          total: tools.length,
          active: [...active],
          ...(offset + limit < tools.length ? { nextOffset: offset + limit } : {}),
        },
      };
    },
  });
}
