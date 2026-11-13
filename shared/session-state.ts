import { z } from "zod";

export const SessionPhaseSchema = z.enum(["idle", "running", "writing", "stopped", "failed"]);
export type SessionPhase = z.infer<typeof SessionPhaseSchema>;

const contextSchema = z.object({
  kind: z.enum(["selection", "symbol", "task", "pull-request", "mcp-resource"]),
  source: z.string(),
  label: z.string(),
  text: z.string(),
});
const queueSchema = z.object({
  id: z.string(),
  text: z.string(),
  mode: z.enum(["queue", "steer"]),
  state: z.enum(["pending", "sending", "sent", "cancelled"]),
  attachments: z.array(z.string()).optional(),
  contexts: z.array(contextSchema).optional(),
});
const approvalSchema = z.object({
  id: z.string(),
  action: z.string(),
  tool: z.string(),
  target: z.string(),
  reason: z.string(),
  humanOnly: z.boolean().optional(),
  risks: z.array(z.object({ id: z.string(), label: z.string(), detail: z.string() })).optional(),
  callId: z.string().optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
  cwd: z.string().optional(),
  paths: z.array(z.string()).optional(),
  requestReason: z.string().optional(),
  grantLabel: z.string().optional(),
  actor: z.string().optional(),
  arguments: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
});
const jobSchema = z.object({
  id: z.string(),
  command: z.string(),
  cwd: z.string(),
  status: z.enum(["running", "exited", "failed", "stopped"]),
  pid: z.number().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  durationMs: z.number(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  timedOut: z.boolean(),
  logBytes: z.number(),
  error: z.string().nullable(),
});

/** One authoritative snapshot, versioned within a core handle's lifetime. */
export const SessionStateSchema = z.object({
  sessionId: z.string(),
  epoch: z.string(),
  revision: z.number().int().nonnegative(),
  phase: SessionPhaseSchema,
  running: z.boolean(),
  stopRequested: z.boolean().optional(),
  interrupted: z.boolean(),
  turns: z.number().int().nonnegative(),
  queue: z.array(queueSchema),
  approvals: z.array(approvalSchema),
  approvalResolutions: z
    .array(
      z.object({
        id: z.string(),
        choice: z.enum(["allow_once", "allow_session", "allow_always", "deny"]),
        by: z.enum(["user", "timeout", "aborted", "policy", "persistence"]),
      }),
    )
    .optional(),
  jobs: z.array(jobSchema),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

/** A response captured before a newer event cannot roll state backwards. */
export function newerSessionState(
  current: SessionState | null,
  next: SessionState,
  retiredEpochs: ReadonlySet<string> = new Set(),
): boolean {
  if (retiredEpochs.has(next.epoch)) return false;
  return (
    !current ||
    current.sessionId !== next.sessionId ||
    current.epoch !== next.epoch ||
    next.revision > current.revision
  );
}
