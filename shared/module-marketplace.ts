import { z } from "zod";
import { ModuleIdSchema } from "./modules";

/** Live catalog of the Flecten repository; GitHub serves it once the repository is public. */
export const FLECTEN_MARKETPLACE_URL =
  "https://raw.githubusercontent.com/AnnenkovLabs/flecten/main/src/marketplace/index.json";

export const MarketplaceUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  }, "Use an HTTPS catalog URL without credentials or a fragment");
export const ModuleRevisionSchema = z
  .string()
  .length(64)
  .refine(
    (value) => [...value].every((c) => (c >= "0" && c <= "9") || (c >= "a" && c <= "f")),
    "Use a lowercase SHA-256 hash",
  );
export const MarketplaceCategorySchema = z.enum(["workflow", "interface", "platform"]);
export const MarketplaceEntrySchema = z.object({
  source: z.string(),
  name: ModuleIdSchema,
  title: z.string().min(1).max(100),
  publisher: z.string().min(1).max(100),
  category: MarketplaceCategorySchema,
  description: z.string(),
  version: z.string(),
  revision: ModuleRevisionSchema,
  requires: z.array(ModuleIdSchema),
  capabilities: z.array(z.string()),
  native: z.boolean(),
  interface: z.boolean(),
  platformScope: z.enum(["session", "project"]).optional(),
});
export type MarketplaceEntry = z.infer<typeof MarketplaceEntrySchema>;
export const MarketplaceStateSchema = z.object({
  sources: z.array(z.object({ id: z.string(), name: z.string(), bundled: z.boolean() })),
  entries: z.array(MarketplaceEntrySchema),
  errors: z.array(z.object({ source: z.string(), message: z.string() })),
});
export type MarketplaceState = z.infer<typeof MarketplaceStateSchema>;
export const MarketplaceActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), refresh: z.boolean().optional() }),
  z.object({ action: z.literal("addSource"), url: MarketplaceUrlSchema }),
  z.object({ action: z.literal("removeSource"), url: MarketplaceUrlSchema }),
  z.object({
    action: z.literal("install"),
    source: z.string().min(1).max(2048),
    name: ModuleIdSchema,
    revision: ModuleRevisionSchema,
  }),
]);
export type MarketplaceAction = z.infer<typeof MarketplaceActionSchema>;
