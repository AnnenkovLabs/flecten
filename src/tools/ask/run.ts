import type { ToolResult } from "../../core/types";
import type { ToolContext } from "../types";
import { defineTool } from "../types";
import { type AskArgs, type AskOption, askSpec } from "./schema";

function label(option: AskOption): string {
  return typeof option === "string" ? option : option.label;
}

function description(option: AskOption): string | undefined {
  return typeof option === "string" ? undefined : option.description;
}

export async function runAsk(args: AskArgs, _context: ToolContext): Promise<ToolResult> {
  const allowCustom = args.allowCustom !== false;
  const lines: string[] = [`Question: ${args.question}`];
  if (args.options.length === 0) {
    lines.push("Answer: free-form");
  } else {
    lines.push("Options:");
    for (const [index, option] of args.options.entries()) {
      const detail = description(option);
      lines.push(`${index + 1}. ${label(option)}${detail === undefined ? "" : ` - ${detail}`}`);
    }
    lines.push(allowCustom ? "Custom answer: allowed" : "Custom answer: not allowed");
  }

  return {
    ok: true,
    output: lines.join("\n"),
    data: {
      kind: "question",
      question: args.question,
      options: args.options,
    },
  };
}

export const askTool = defineTool({
  ...askSpec,
  execute: runAsk,
});
