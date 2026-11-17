import type { ContextMessage } from "../../context";
import { markdownCode, markdownValue } from "../../util/markdown";

function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const room = Math.max(0, limit - 80);
  const head = Math.ceil(room / 2);
  const tail = Math.floor(room / 2);
  return `${text.slice(0, head)}\n[... ${text.length - head - tail} characters omitted; inspect the archived transcript ...]\n${tail ? text.slice(-tail) : ""}`;
}

function messageText(message: ContextMessage): string {
  if (message.role === "user") {
    const title = message.sourceText === undefined ? "Conversation context" : "User message";
    const original =
      message.sourceText !== undefined && message.sourceText !== message.content
        ? `\n\nOriginal user evidence (verbatim):\n${message.sourceText}`
        : "";
    return `## ${title}\n\n${message.content}${original}`;
  }
  if (message.role === "assistant") {
    const calls = (message.toolCalls ?? [])
      .map(
        (call) =>
          `### Tool call\n\n- Name: ${markdownValue(call.name)}\n- Tool call identifier: ${markdownValue(call.id ?? "unavailable")}\n\nArguments:\n\n${markdownCode(JSON.stringify(call.args ?? {}), "json")}`,
      )
      .join("\n\n");
    return `## Assistant message${message.content ? `\n\n${message.content}` : ""}${calls ? `\n\n${calls}` : ""}`;
  }
  return `## Tool result\n\n- Name: ${markdownValue(message.name)}\n- Status: ${markdownValue(message.isError ? "failure" : "success")}\n- Tool call identifier: ${markdownValue(message.toolCallId)}\n\n${message.content}`;
}

/** No fixed per-message cap: all content fits when the model input budget permits it. */
export function pageTranscript(messages: readonly ContextMessage[], maxChars: number): string {
  if (maxChars <= 0) return "";
  const rendered = messages.map(messageText);
  const full = rendered.join("\n\n");
  if (full.length <= maxChars) return full;
  // ponytail: fair excerpts cannot select semantic records. Completed pages bypass model
  // summarization using their typed findings/result; emergency checkpoints retain full archives.
  const separatorBudget = Math.max(0, (rendered.length - 1) * 2);
  const perMessage = Math.floor((maxChars - separatorBudget) / Math.max(1, rendered.length));
  if (perMessage < 160) return excerpt(full, maxChars).slice(0, maxChars);
  return rendered
    .map((text) => excerpt(text, perMessage))
    .join("\n\n")
    .slice(0, maxChars);
}
