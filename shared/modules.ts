import { z } from "zod";
import {
  ModuleHarnessAccessSchema,
  ModuleHostCommandSchema,
  ModuleInterfaceSchema,
  ModulePlacementSchema,
} from "./module-interface";

export const ModuleIdSchema = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (name) => [...name].every((c) => (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-"),
    "Use lowercase letters, digits and hyphens",
  );
export const ModuleReferencesSchema = z
  .array(
    z
      .object({
        name: ModuleIdSchema,
        revision: z.string().min(1).max(128),
        requested: z.boolean(),
        contextRevision: z.string().max(128).optional(),
      })
      .strict(),
  )
  .max(32);
export type ModuleReference = z.infer<typeof ModuleReferencesSchema>[number];

export const ModuleViewSchema = z.object({
  name: ModuleIdSchema,
  version: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()),
  path: z.string(),
  revision: z.string(),
  trusted: z.boolean(),
  enabled: z.boolean(),
  development: z.boolean(),
  interfaceEnabled: z.boolean().default(false),
  requires: z.array(z.string()),
  platformScope: z.enum(["session", "project"]).optional(),
  contributions: z.object({
    instructions: z.number(),
    resources: z.number(),
    servers: z.number(),
    hooks: z.number(),
    surfaces: z.number(),
    styles: z.number().default(0),
  }),
});
export type ModuleView = z.infer<typeof ModuleViewSchema>;
export const ModuleSurfaceSchema = z.object({
  module: ModuleIdSchema,
  id: ModuleIdSchema,
  title: z.string(),
  revision: z.string(),
  placement: ModulePlacementSchema.optional(),
  harness: ModuleHarnessAccessSchema,
});
export type ModuleSurface = z.infer<typeof ModuleSurfaceSchema>;
export const ModuleStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  modules: z.array(ModuleViewSchema),
  active: ModuleReferencesSchema,
  surfaces: z.array(ModuleSurfaceSchema),
  interfaces: z.array(ModuleInterfaceSchema).default([]),
  services: z
    .array(
      z.object({
        owner: z.string(),
        service: z.string(),
        mode: z.enum(["provide", "replace", "wrap"]),
      }),
    )
    .optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});
export type ModuleState = z.infer<typeof ModuleStateSchema>;

export const ModuleChangeSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("install"), path: z.string().min(1) }),
  z.object({ operation: z.literal("trust"), path: z.string().min(1), revision: z.string().min(1) }),
  z.object({ operation: z.literal("enable"), path: z.string().min(1), enabled: z.boolean() }),
  z.object({ operation: z.literal("development"), path: z.string().min(1), enabled: z.boolean() }),
  z.object({ operation: z.literal("remove"), path: z.string().min(1) }),
  z.object({ operation: z.literal("interface"), path: z.string().min(1), enabled: z.boolean() }),
]);
export type ModuleChange = z.infer<typeof ModuleChangeSchema>;

export const ModuleFrameRequestSchema = z
  .object({
    type: z.literal("flecten.module.request"),
    id: z.string().min(1).max(100),
    method: z.enum(["tools", "call", "read", "snapshot", "subscribe", "request"]),
    command: ModuleHostCommandSchema.optional(),
    tool: z.string().min(1).max(256).optional(),
    arguments: z.record(z.string(), z.unknown()).optional(),
    resource: z.string().min(1).max(256).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();
