import { z } from "zod";

export const MODULE_SURFACE_BYTES = 8 * 1024 * 1024;

/** Standard CSS selectors and DOM insertion positions, independent of product widgets. */
export const ModulePlacementSchema = z
  .object({
    selector: z.string().min(1).max(512),
    position: z.enum(["replace", "before", "after", "prepend", "append"]),
    order: z.number().int().min(-1000).max(1000).default(0),
  })
  .strict();
export const ModuleHarnessAccessSchema = z
  .object({
    commands: z.array(z.string().min(1).max(100)).max(128).default([]),
    state: z.boolean().default(false),
    events: z.boolean().default(false),
  })
  .strict()
  .prefault({});
export const ModuleInterfaceSchema = z.object({
  module: z.string(),
  revision: z.string(),
  styles: z.number().int().nonnegative(),
  surfaces: z.array(z.string()),
});
export type ModuleInterface = z.infer<typeof ModuleInterfaceSchema>;
export const ModuleHostCommandSchema = z
  .object({
    type: z.string().min(1).max(100),
  })
  .catchall(z.unknown());
export type ModuleHostCommand = z.infer<typeof ModuleHostCommandSchema>;
