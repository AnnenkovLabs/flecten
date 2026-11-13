import type { ContextSummary } from "../../context";
import { toolMessage } from "../../core/loop/tool-message";
import { withdrawMemoryMessages } from "../../core/memory/withdraw";
import type { Event, Message, ToolCall, ToolResult, Usage } from "../../core/types";
import { addUsage, emptyUsage } from "../../core/types/message";

export interface ReplayEvent {
  seq: number;
  event: Event;
}

export interface ReplayGap {
  afterSeq: number;
  beforeSeq: number;
}

export interface ReplayResult {
  messages: Message[];
  gaps: ReplayGap[];
  duplicateSeqs: number[];
  usage: Usage;
}

interface PendingTools {
  calls: ToolCall[];
  results: Map<string, { call: ToolCall; result: ToolResult }>;
}

function withSummary(text: string, summary: string | undefined): string {
  if (!summary) return text;
  const block = `<summary>${summary}</summary>`;
  return text.trim().length === 0 || text.trim() === summary.trim() ? block : `${text}\n\n${block}`;
}

/**
 * Applies a compaction to the replayed history: the summary page replaces everything except
 * the kept tail, and the tail never starts with a tool result whose call was summarized.
 */
function compactReplayed(
  messages: Message[],
  summary: string,
  kept: number | undefined,
  contextSummary?: ContextSummary,
): void {
  if (kept === undefined) return;
  let start = Math.max(0, messages.length - kept);
  while (start < messages.length && messages[start]?.role === "tool") start += 1;
  messages.splice(0, start, {
    role: "user",
    content: summary,
    ...(contextSummary ? { contextSummary } : {}),
  });
}

export function replayMessages(envelopes: readonly ReplayEvent[]): ReplayResult {
  const messages: Message[] = [];
  const gaps: ReplayGap[] = [];
  const duplicateSeqs: number[] = [];
  const seen = new Set<number>();
  let lastSeq = 0;
  let usage = emptyUsage();
  let usageEvents = 0;
  let pending: PendingTools | undefined;
  let eligibleUserSource = true;
  let workingLanguage: "en" | undefined;
  let sourceLanguage: string | undefined;

  function flushTools(): void {
    if (!pending) return;
    const { calls, results } = pending;
    pending = undefined;
    const emitted = new Set<string>();
    for (const call of calls) {
      const entry = results.get(call.id);
      emitted.add(call.id);
      messages.push(
        toolMessage(
          call,
          entry?.result ?? {
            ok: false,
            output: "",
            error:
              "The run was interrupted before this tool result was saved. Whether the operation completed is unknown. Inspect the current state before retrying a mutation.",
          },
        ),
      );
    }
    for (const [id, entry] of results) {
      if (!emitted.has(id)) messages.push(toolMessage(entry.call, entry.result));
    }
  }

  for (const envelope of envelopes) {
    if (seen.has(envelope.seq)) {
      duplicateSeqs.push(envelope.seq);
      continue;
    }
    seen.add(envelope.seq);
    if (envelope.seq > lastSeq + 1) {
      gaps.push({ afterSeq: lastSeq, beforeSeq: envelope.seq });
    }
    lastSeq = Math.max(lastSeq, envelope.seq);

    const event = envelope.event;
    switch (event.type) {
      case "session.started":
        workingLanguage = undefined;
        eligibleUserSource = event.role !== "worker" && !event.internal;
        flushTools();
        messages.push({
          role: "user",
          content: event.input ?? event.prompt,
          ...(eligibleUserSource ? { memorySource: event.prompt } : {}),
          ...(event.attachments?.length ? { attachmentRefs: event.attachments } : {}),
        });
        break;
      case "input.translated": {
        const user = messages.findLast((message) => message.role === "user");
        if (user?.role === "user") {
          user.content = event.input;
          user.workingLanguage = "en";
          user.sourceLanguage = event.language;
        }
        workingLanguage = "en";
        sourceLanguage = event.language;
        break;
      }
      case "message.finished":
        flushTools();
        messages.push({
          role: "assistant",
          ...(workingLanguage ? { workingLanguage } : {}),
          content: withSummary(event.text, event.summary),
          reasoning: event.reasoning,
          toolCalls: event.toolCalls,
          ...(event.providerData === undefined ? {} : { providerData: event.providerData }),
        });
        pending =
          event.toolCalls.length > 0 ? { calls: event.toolCalls, results: new Map() } : undefined;
        break;
      case "tool.finished":
        if (pending) {
          pending.results.set(event.call.id, { call: event.call, result: event.result });
        } else {
          messages.push(toolMessage(event.call, event.result));
        }
        break;
      case "steer.applied":
        flushTools();
        messages.push({
          role: "user",
          ...(workingLanguage
            ? { workingLanguage, ...(sourceLanguage ? { sourceLanguage } : {}) }
            : {}),
          content: event.input ?? event.text,
          ...(eligibleUserSource ? { memorySource: event.text } : {}),
          ...(event.attachments?.length ? { attachmentRefs: event.attachments } : {}),
        });
        break;
      case "memory.context":
        flushTools();
        withdrawMemoryMessages(
          messages,
          event.references.filter((reference) => reference.level === "invalidated"),
        );
        messages.push({ role: "user", content: event.text, memoryReferences: event.references });
        break;
      case "notice.applied":
        flushTools();
        messages.push({
          role: "user",
          content: event.text,
          ...(event.moduleReferences ? { moduleReferences: event.moduleReferences } : {}),
          ...(event.attachments?.length ? { attachmentRefs: event.attachments } : {}),
        });
        break;
      case "context.compacted":
        flushTools();
        compactReplayed(messages, event.summary, event.kept, event.contextSummary);
        if (workingLanguage && messages[0]?.role === "user") {
          messages[0].workingLanguage = workingLanguage;
          if (sourceLanguage) messages[0].sourceLanguage = sourceLanguage;
        }
        break;
      case "usage":
        usage = addUsage(usage, event.usage);
        usageEvents += 1;
        break;
      case "turn.finished":
        flushTools();
        break;
      case "session.finished":
        flushTools();
        if (usageEvents === 0) usage = event.result.usage;
        break;
      default:
        break;
    }
  }

  flushTools();
  return { messages, gaps, duplicateSeqs, usage };
}
