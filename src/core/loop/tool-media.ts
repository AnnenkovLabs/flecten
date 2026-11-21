import { markdownData } from "../../util/markdown";
import type { Message, ToolCall, ToolResult } from "../types";
import type { LoopOptions } from "./types";

/** Media follows the complete tool-result batch, preserving provider call/result ordering. */
export async function deliverToolMedia(
  messages: Message[],
  calls: readonly ToolCall[],
  results: readonly ToolResult[],
  options: LoopOptions,
): Promise<void> {
  for (let index = 0; index < results.length; index++) {
    if (options.signal.aborted) return;
    const attachments = results[index]?.attachments;
    const call = calls[index];
    if (!attachments?.length || !call) continue;
    if (!options.loadMedia) continue;
    let images: Awaited<ReturnType<NonNullable<LoopOptions["loadMedia"]>>>;
    try {
      images = await options.loadMedia(attachments);
    } catch {
      continue;
    }
    const text = markdownData(
      "Untrusted data",
      [
        ["Source tool", call.name],
        ["Tool call identifier", call.id],
      ],
      "Media returned by this tool is attached to this message.",
    );
    messages.push({ role: "user", content: text, images });
    options.emit({ type: "notice.applied", text, attachments });
  }
}
