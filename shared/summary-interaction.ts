import { z } from "zod";

export const MAX_SUMMARY_INTERACTION_NAME = 64;
export const MAX_SUMMARY_INTERACTION_VALUE = 256;
export const MAX_SUMMARY_INTERACTION_DELAY_MS = 3_600_000;

const delayMs = z.number().int().min(1).max(MAX_SUMMARY_INTERACTION_DELAY_MS);
export const SummaryInteractionDeliverySchema = z.discriminatedUnion("when", [
  z.strictObject({ when: z.literal("next-message") }),
  z.strictObject({ when: z.literal("after-delay"), delayMs }),
  z.strictObject({ when: z.literal("after-first-interaction"), delayMs }),
  z.strictObject({ when: z.literal("on-action") }),
]);

export const SummaryInteractionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("configure"), delivery: SummaryInteractionDeliverySchema }),
  z.strictObject({
    kind: z.literal("capture"),
    name: z.string().trim().min(1).max(MAX_SUMMARY_INTERACTION_NAME),
    value: z.union([
      z.string().max(MAX_SUMMARY_INTERACTION_VALUE),
      z.number(),
      z.boolean(),
      z.null(),
    ]),
  }),
  z.strictObject({ kind: z.literal("trigger") }),
]);
export const SummaryInteractionPacketSchema = z.strictObject({
  generation: z.number().int().nonnegative(),
  interaction: SummaryInteractionSchema,
});

export type SummaryInteractionDelivery = z.infer<typeof SummaryInteractionDeliverySchema>;
export type SummaryInteraction = z.infer<typeof SummaryInteractionSchema>;
export type SummaryInteractionCommand = {
  type: "summary.interaction";
  sessionId: string;
  summaryId: string;
  interaction: SummaryInteraction;
};
