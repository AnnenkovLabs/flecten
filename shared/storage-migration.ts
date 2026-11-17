import { z } from "zod";

export const StorageMigrationStateSchema = z.object({
  version: z.literal(1),
  phase: z.enum(["required", "running", "failed", "complete"]),
  step: z.enum(["inspect", "backup", "merge", "verify", "publish"]),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  paths: z.array(z.string()),
  currentPath: z.string().optional(),
  backups: z.array(z.string()),
  error: z.string().optional(),
});

export type StorageMigrationState = z.infer<typeof StorageMigrationStateSchema>;
export type StorageMigrationEvent = { type: "storage.migration"; migration: StorageMigrationState };
export type StorageMigrationCommand = {
  type: "storage.migrate" | "storage.accept" | "storage.status";
  requestId?: string;
};
