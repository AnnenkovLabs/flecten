import { z } from "zod";
import { ModuleIdSchema } from "../../shared/modules";

const List = z
  .object({
    operation: z.literal("list"),
    capability: z.string().max(128).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();
const Status = z.object({ operation: z.literal("status") }).strict();
const Tools = z
  .object({
    operation: z.literal("tools"),
    name: ModuleIdSchema,
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();
const Read = z
  .object({
    operation: z.literal("read"),
    name: ModuleIdSchema,
    resource: z.string().min(1).max(128),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ModuleInspectionActionSchema = z.discriminatedUnion("operation", [
  List,
  Status,
  Tools,
  Read,
]);

export const ModuleActionSchema = z.discriminatedUnion("operation", [
  List,
  z.object({ operation: z.literal("activate"), name: ModuleIdSchema }).strict(),
  z.object({ operation: z.literal("deactivate"), name: ModuleIdSchema }).strict(),
  Status,
  Tools,
  z
    .object({
      operation: z.literal("call"),
      name: ModuleIdSchema,
      tool: z.string().min(1).max(256),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict(),
  Read,
]);
export type ModuleAction = z.infer<typeof ModuleActionSchema>;
