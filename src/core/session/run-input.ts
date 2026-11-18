import type { ModelProvider } from "../../providers/types";
import { markdownData } from "../../util/markdown";
import { withAttachmentBlocks } from "../attachments";
import { type ContextReference, contextReferenceBlock } from "../context-reference";
import type { Message, SessionId } from "../types";
import { assertHistoryMedia, sessionAttachments } from "./media";
import type { SessionOptions } from "./options";
import type { RunExtras } from "./runtime";

export type { MemoryPort as SessionMemory } from "../memory/types";

export function lastUsedTarget(
  provider: ModelProvider,
): { provider: string; model: string } | undefined {
  const candidate = (provider as { lastUsed?: unknown }).lastUsed;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const { provider: id, model } = candidate as { provider?: unknown; model?: unknown };
  return typeof id === "string" && typeof model === "string" ? { provider: id, model } : undefined;
}

export function promptWithHookContext(prompt: string, contexts: readonly string[]): string {
  if (contexts.length === 0) return prompt;
  const context = contexts
    .map((text) => markdownData("Hook context", [["Source", "configured hook"]], text))
    .join("\n\n");
  return `${context}\n\n${prompt}`;
}

export function withRunContext(
  prompt: string,
  attachments: readonly string[],
  contexts: readonly ContextReference[],
): string {
  const blocks = [...attachments];
  const interactions: string[] = [];
  for (const context of contexts) {
    const target = context.kind === "summary-interaction" ? interactions : blocks;
    target.push(contextReferenceBlock(context));
  }
  return [withAttachmentBlocks(prompt, blocks), ...interactions].join("\n\n");
}

export async function prepareSessionInput(
  prompt: string,
  sessionId: SessionId,
  history: readonly Message[],
  attachmentPaths: readonly string[],
  extras: RunExtras,
  options: SessionOptions,
) {
  const expanded = options.expandPrompt ? await options.expandPrompt(prompt) : prompt;
  assertHistoryMedia(history, options);
  const attached = await sessionAttachments(
    attachmentPaths,
    sessionId,
    options,
    extras.attachmentSnapshot,
  );
  const summary =
    !extras.internal && !extras.resumed && options.role !== "worker"
      ? options.takeSummaryContext?.(sessionId)
      : undefined;
  const contexts = summary ? [...(extras.contexts ?? []), summary] : (extras.contexts ?? []);
  const input = withRunContext(expanded, attached.blocks, contexts);
  return { sessionId, expanded, input, attached };
}
