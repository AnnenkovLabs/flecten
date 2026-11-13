import { z } from "zod";
import { MarketplaceUrlSchema } from "../../shared/module-marketplace";

export const ModulesConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    marketplaces: z.array(MarketplaceUrlSchema).max(8).default([]),
    dirs: z.array(z.string().min(1)).max(128).default([]),
    roots: z.array(z.string().min(1)).max(16).default([".agents/modules"]),
    trusted: z.record(z.string(), z.string()).default({}),
    development: z.array(z.string().min(1)).max(128).default([]),
    disabled: z.array(z.string().min(1)).max(128).default([]),
    interfaces: z.array(z.string().min(1)).max(32).default([]),
    maxActive: z.number().int().min(1).max(32).default(16),
    contextCharacters: z.number().int().min(1000).max(128_000).default(32_000),
  })
  .strict();
export type ModulesConfig = z.infer<typeof ModulesConfigSchema>;
