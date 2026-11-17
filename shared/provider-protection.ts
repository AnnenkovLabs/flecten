import { z } from "zod";

export const ProviderGatewayInspectionSchema = z.object({
  gateway: z.enum(["new-api", "one-api", "unknown"]),
  confidence: z.enum(["confirmed", "suspected", "unknown"]),
  evidence: z
    .array(
      z.object({
        id: z.string().max(128),
        source: z.string().max(2048),
        detail: z.string().max(1024),
      }),
    )
    .max(64),
  checkedAt: z.string().datetime(),
});

export type ProviderGatewayInspection = z.infer<typeof ProviderGatewayInspectionSchema>;

export const ProviderProtectionSchema = z.object({
  enabled: z.boolean(),
  checkedBaseUrl: z.string().url().optional(),
  inspection: ProviderGatewayInspectionSchema.optional(),
});

export type ProviderProtection = z.infer<typeof ProviderProtectionSchema>;
