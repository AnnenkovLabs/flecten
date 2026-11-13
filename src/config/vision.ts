import { z } from "zod";

export const VisionConfigSchema = z.object({
  /** Empty provider follows the working model's provider; empty model selects by price. */
  provider: z.string().default(""),
  model: z.string().default(""),
});
