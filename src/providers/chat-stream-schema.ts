import { z } from "zod";

const content = z.union([
  z.string(),
  z.array(z.looseObject({ type: z.string().optional(), text: z.string() })),
]);
const delta = z.looseObject({
  role: z.string().nullable().optional(),
  content: content.nullable().optional(),
  reasoning_content: z.string().nullable().optional(),
  reasoning: z.string().nullable().optional(),
  reasoning_text: z.string().nullable().optional(),
  reasoning_details: z.array(z.unknown()).nullable().optional(),
  refusal: z.string().nullable().optional(),
  function_call: z
    .looseObject({
      name: z.string().nullable().optional(),
      arguments: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  tool_calls: z
    .array(
      z.looseObject({
        index: z.number().int().nonnegative().nullable().optional(),
        id: z.string().nullable().optional(),
        type: z
          .union([z.literal("function"), z.literal("")])
          .nullable()
          .optional(),
        extra_content: z.unknown().optional(),
        function: z
          .looseObject({
            name: z.string().nullable().optional(),
            arguments: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .nullable()
    .optional(),
});
const tokenCount = z.number().int().nonnegative().nullable().optional();
const tokenDetails = z.looseObject({ reasoning_tokens: tokenCount }).nullable().optional();
export const ChatChunkSchema = z.looseObject({
  choices: z
    .array(
      z.looseObject({
        delta: delta.nullable().optional(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  usage: z
    .looseObject({
      prompt_tokens: tokenCount,
      completion_tokens: tokenCount,
      input_tokens: tokenCount,
      output_tokens: tokenCount,
      completion_tokens_details: tokenDetails,
      output_tokens_details: tokenDetails,
      prompt_tokens_details: z.looseObject({ cached_tokens: tokenCount }).nullable().optional(),
      prompt_cache_hit_tokens: tokenCount,
    })
    .nullable()
    .optional(),
  error: z.unknown().optional(),
});

export type ChatChunk = z.infer<typeof ChatChunkSchema>;
