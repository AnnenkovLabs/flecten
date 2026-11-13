import { z } from "zod";
import type { ContextMessage } from "../../context";
import { markdownCode, markdownData, markdownValue } from "../../util/markdown";
import type { ToolResult } from "../types";

export const PageReadSchema = z
  .object({
    page: z.number().int().positive(),
    kind: z.enum(["summary", "transcript"]).optional(),
    offset: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(2000).optional(),
  })
  .strict();

export const PageSearchSchema = z
  .object({
    query: z.string().min(1).max(1000),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict();

export type PageAccess = (path: string) => Promise<boolean>;

export interface PageArchive {
  list(access?: PageAccess): Promise<ToolResult>;
  read(input: z.infer<typeof PageReadSchema>, access?: PageAccess): Promise<ToolResult>;
  search(input: z.infer<typeof PageSearchSchema>, access?: PageAccess): Promise<ToolResult>;
}

/** Lossless text archive. The smaller summarizer transcript is a separate model input. */
export function archiveTranscript(page: number, messages: readonly ContextMessage[]): string {
  const sections = messages.map((message, index) => {
    const title = `${index + 1}. ${message.role}`;
    if (message.role === "user") {
      return [
        markdownData(title, [], message.content),
        ...(message.sourceText !== undefined && message.sourceText !== message.content
          ? [markdownData("Original user message (verbatim)", [], message.sourceText)]
          : []),
      ].join("\n\n");
    }
    if (message.role === "tool") {
      return markdownData(
        title,
        [
          ["Name", message.name],
          ["Tool call identifier", message.toolCallId],
          ["Status", message.isError ? "failure" : "success"],
        ],
        message.content,
      );
    }
    return [
      markdownData(title, [], message.content),
      ...(message.reasoning ? [markdownData("Reasoning", [], message.reasoning)] : []),
      ...(message.toolCalls ?? []).map((call) =>
        [
          "### Tool call",
          `- Name: ${markdownValue(call.name)}`,
          `- Tool call identifier: ${markdownValue(call.id ?? "unavailable")}`,
          "",
          markdownCode(JSON.stringify(call.args ?? {}, null, 2), "json"),
        ].join("\n"),
      ),
    ].join("\n\n");
  });
  return [`# Page ${page} transcript`, ...sections].join("\n\n");
}
