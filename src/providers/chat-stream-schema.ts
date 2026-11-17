import { z } from "zod";

const content = z.union([
  z.string(),
  z.array(z.looseObject({ type: z.string().optional(), text: z.string() })),
]);
const delta = z.looseObject({
  role: z.string().optional(),
  content: content.nullable().optional(),
  reasoning_content: z.string().nullable().optional(),
  reasoning: z.string().nullable().optional(),
  reasoning_text: z.string().nullable().optional(),
  reasoning_details: z.array(z.unknown()).optional(),
  refusal: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.looseObject({
        index: z.number().int().nonnegative(),
        id: z.string().optional(),
        type: z.literal("function").optional(),
        extra_content: z.unknown().optional(),
        function: z
          .looseObject({ name: z.string().optional(), arguments: z.string().optional() })
          .optional(),
      }),
    )
    .optional(),
});
const tokenCount = z.number().int().nonnegative().optional();
const tokenDetails = z.looseObject({ reasoning_tokens: tokenCount });
export const ChatChunkSchema = z.looseObject({
  choices: z
    .array(
      z.looseObject({
        delta: delta.optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usage: z
    .looseObject({
      prompt_tokens: tokenCount,
      completion_tokens: tokenCount,
      completion_tokens_details: tokenDetails.optional(),
      output_tokens_details: tokenDetails.optional(),
      prompt_tokens_details: z.looseObject({ cached_tokens: tokenCount }).optional(),
      prompt_cache_hit_tokens: tokenCount,
    })
    .nullable()
    .optional(),
  error: z.unknown().optional(),
});

export type ChatChunk = z.infer<typeof ChatChunkSchema>;
