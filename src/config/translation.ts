import { z } from "zod";

export const TranslationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.string().min(1),
  model: z.string(),
  /** BCP 47, or auto to follow the current user message. */
  language: z
    .string()
    .min(2)
    .max(35)
    .default("auto")
    .refine((value) => {
      if (value === "auto") return true;
      try {
        return Intl.getCanonicalLocales(value).length === 1;
      } catch {
        return false;
      }
    }, "Use auto or a BCP 47 language tag"),
  timeoutMs: z.number().int().min(1000).max(120_000).default(60_000),
});

export type TranslationConfig = z.infer<typeof TranslationConfigSchema>;
