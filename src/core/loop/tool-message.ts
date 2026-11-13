import { ModuleReferencesSchema } from "../../../shared/modules";
import { markdownData } from "../../util/markdown";
import { MemoryReferencesSchema } from "../memory/command";
import type { Provenance, ToolCall, ToolMessage, ToolResult } from "../types";

const REF_LIMIT = 240;

/**
 * Wraps data from files, web pages, MCP servers and commands so the model can tell it from
 * instructions. The prompt says text inside the block carries no authority.
 */
export function wrapUntrusted(text: string, provenance: Provenance): string {
  const reference =
    provenance.ref === undefined
      ? undefined
      : `${provenance.ref.slice(0, REF_LIMIT)}${provenance.ref.length > REF_LIMIT ? "..." : ""}`;
  return markdownData(
    "Untrusted data",
    [
      ["Source", provenance.source],
      ["Source reference", reference],
      ["Trust", "untrusted"],
    ],
    text,
  );
}

function joined(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join("\n\n");
}

/** The exact text the model reads for a tool result; replay rebuilds history with it too. */
export function toolContent(result: ToolResult): string {
  const data =
    result.provenance && result.output.length > 0
      ? wrapUntrusted(result.output, result.provenance)
      : result.output;
  if (result.ok) {
    return joined([result.notice, data, result.trailer]) || "(no output)";
  }
  const detail = result.error ?? "tool failed";
  return joined([`Error: ${detail}`, result.notice, data, result.trailer]);
}

export function toolMessage(call: ToolCall, result: ToolResult): ToolMessage {
  const modules =
    call.name === "module" && result.ok
      ? ModuleReferencesSchema.safeParse(
          (result.data as { moduleReferences?: unknown } | undefined)?.moduleReferences,
        )
      : undefined;
  const references =
    (call.name === "memory" || call.name === "done") && result.ok
      ? MemoryReferencesSchema.safeParse(
          (result.data as { memoryReferences?: unknown } | undefined)?.memoryReferences,
        )
      : undefined;
  return {
    role: "tool",
    toolCallId: call.id,
    name: call.name,
    content: toolContent(result),
    ...(references?.success ? { memoryReferences: references.data } : {}),
    ...(modules?.success ? { moduleReferences: modules.data } : {}),
    ...(result.ok ? {} : { isError: true }),
  };
}
