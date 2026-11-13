import { isAbsolute } from "node:path";
import { z } from "zod";
import { ModuleHarnessAccessSchema, ModulePlacementSchema } from "../../shared/module-interface";
import { ModuleIdSchema } from "../../shared/modules";
import { HooksConfigSchema } from "../config/schema-sections";
import { McpServerConfigSchema } from "../mcp/config";

export const ModuleResourcePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !isAbsolute(path) &&
      !path.includes("\\") &&
      !path.split("/").some((part) => part === ".." || part === "." || part === ""),
    "Use a relative path inside the module",
  );
const resourcePath = ModuleResourcePathSchema;
export const ModuleManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: ModuleIdSchema,
    version: z.string().min(1).max(80),
    description: z.string().min(1).max(2000),
    capabilities: z.array(z.string().min(1).max(128)).max(32).default([]),
    requires: z.array(ModuleIdSchema).max(16).default([]),
    conflicts: z.array(ModuleIdSchema).max(16).default([]),
    instructions: z.array(resourcePath).max(32).default([]),
    styles: z.array(resourcePath).max(16).default([]),
    resources: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            path: resourcePath,
            description: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .max(256)
      .default([]),
    runtime: z
      .object({
        entry: resourcePath,
        readOnlyTools: z.array(z.string().min(1).max(256)).max(128).optional(),
      })
      .strict()
      .optional(),
    platform: z
      .object({ entry: resourcePath, scope: z.enum(["session", "project"]).default("session") })
      .strict()
      .optional(),
    mcp: z
      .object({ servers: z.record(ModuleIdSchema, McpServerConfigSchema).default({}) })
      .prefault({}),
    hooks: HooksConfigSchema,
    surfaces: z
      .array(
        z
          .object({
            id: ModuleIdSchema,
            title: z.string().min(1).max(100),
            entry: resourcePath,
            tools: z.array(z.string().min(1).max(256)).max(128).default([]),
            resources: z.array(z.string().min(1).max(128)).max(256).default([]),
            placement: ModulePlacementSchema.optional(),
            harness: ModuleHarnessAccessSchema,
          })
          .strict(),
      )
      .max(16)
      .default([]),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const key of ["resources", "surfaces"] as const) {
      const ids = manifest[key].map((item) => item.id);
      if (new Set(ids).size !== ids.length)
        context.addIssue({ code: "custom", path: [key], message: "Duplicate id" });
    }
    if (Object.keys(manifest.mcp.servers).length > 16)
      context.addIssue({ code: "custom", path: ["mcp"], message: "At most 16 servers" });
    if (manifest.runtime && manifest.mcp.servers.runtime)
      context.addIssue({
        code: "custom",
        path: ["runtime"],
        message: "The runtime server id is reserved for the module SDK",
      });
  });
export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;
