import { z } from "zod";

export const RemoteTargetSchema = z
  .object({
    host: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[A-Za-z0-9][A-Za-z0-9.:-]*$/),
    user: z
      .string()
      .regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/)
      .optional(),
    port: z.number().int().min(1).max(65535).default(22),
    cwd: z
      .string()
      .startsWith("/")
      .max(4096)
      .refine((path) => !path.includes("\0")),
    python: z
      .string()
      .min(1)
      .max(4096)
      .refine((path) => !path.includes("\0"))
      .default("python3"),
  })
  .strict();

export const RemoteSnapshotSchema = z.object({
  id: z.string(),
  argv: z.array(z.string()),
  cwd: z.string(),
  status: z.enum(["starting", "running", "exited", "failed", "stopped", "uncertain"]),
  pid: z.number().int().optional(),
  childPid: z.number().int().optional(),
  startIdentity: z.string().nullable().optional(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  exitCode: z.number().int().optional(),
  error: z.string().optional(),
  output: z.object({ stdout: z.string(), stderr: z.string() }).optional(),
});

export const RemoteJobSchema = z
  .object({
    id: z.string().regex(/^remote-[a-f0-9-]{36}$/),
    target: RemoteTargetSchema,
    directory: z.string(),
    argv: z
      .array(z.string().refine((word) => !word.includes("\0")))
      .min(1)
      .max(1000),
    state: RemoteSnapshotSchema.optional(),
  })
  .strict();
export type RemoteJob = z.infer<typeof RemoteJobSchema>;
