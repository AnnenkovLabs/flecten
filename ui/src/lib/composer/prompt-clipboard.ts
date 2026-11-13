import { z } from "zod";
import type { PromptSnapshot } from "./prompt-document";

export const PROMPT_CLIPBOARD_TYPE = "application/x-liquid-prompt";

const snapshotSchema = z
  .object({
    text: z.string().max(1_000_000),
    mentions: z
      .array(
        z.object({
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
          path: z.string().min(1).max(4096),
          kind: z.enum([
            "file",
            "image",
            "folder",
            "selection",
            "symbol",
            "task",
            "pull-request",
            "mcp-resource",
          ]),
          label: z.string().max(512).optional(),
          context: z
            .object({
              kind: z.enum(["selection", "symbol", "task", "pull-request", "mcp-resource"]),
              source: z.string().max(4096),
              label: z.string().max(512),
              text: z.string().max(60000),
            })
            .optional(),
        }),
      )
      .max(5000),
  })
  .refine(({ text, mentions }) => {
    let previousEnd = 0;
    for (const mention of mentions) {
      if (
        mention.start < previousEnd ||
        mention.end > text.length ||
        mention.end <= mention.start ||
        text.slice(mention.start, mention.end) !== `@${mention.path}`
      )
        return false;
      previousEnd = mention.end;
    }
    return true;
  });

export function readPromptClipboard(raw: string, plainText: string): PromptSnapshot | null {
  try {
    const result = snapshotSchema.safeParse(JSON.parse(raw));
    return result.success && result.data.text === plainText ? result.data : null;
  } catch {
    return null;
  }
}

export function selectionSnapshot(
  snapshot: PromptSnapshot,
  start: number,
  end: number,
): PromptSnapshot {
  return {
    text: snapshot.text.slice(start, end),
    mentions: snapshot.mentions
      .filter((mention) => mention.start >= start && mention.end <= end)
      .map((mention) => ({ ...mention, start: mention.start - start, end: mention.end - start })),
  };
}
