import { MemoryReferencesSchema } from "../../core/memory/command";
import type { ToolResult } from "../../core/types";
import { isObject } from "../../util/json";
import type { ToolContext } from "../types";
import type { DoneArgs } from "./schema";

export async function runDone(
  args: DoneArgs,
  context?: Pick<ToolContext, "memory">,
): Promise<ToolResult> {
  const lines = [
    "Task marked done.",
    `Summary: ${args.summary}`,
    "Evidence:",
    ...args.evidence.map((item) => `- ${item}`),
  ];
  let memory: ToolResult | undefined;
  if (args.memoryCandidates !== undefined) {
    try {
      memory = context?.memory
        ? await context.memory.finish(args.memoryCandidates)
        : { ok: false, output: "", error: "Project memory is unavailable in this execution scope" };
    } catch (error) {
      memory = {
        ok: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    lines.push(
      memory.ok
        ? memory.output
        : `Memory capture failed: ${(memory.error ?? "Unknown memory failure").slice(0, 500)}. Task completion was preserved.`,
    );
  }
  const references =
    memory?.ok && memory.output.length > 0 && isObject(memory.data)
      ? MemoryReferencesSchema.safeParse(memory.data.memoryReferences)
      : undefined;
  return {
    ok: true,
    output: lines.join("\n"),
    terminate: true,
    data: {
      kind: "done",
      summary: args.summary,
      evidence: args.evidence,
      ...(references?.success ? { memoryReferences: references.data } : {}),
    },
  };
}
