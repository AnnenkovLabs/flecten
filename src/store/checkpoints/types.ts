import { z } from "zod";

export type CheckpointTarget = "before" | "after";

export type CheckpointChangeStatus = "added" | "modified" | "deleted" | "unchanged";

export interface CheckpointFile {
  path: string;
  beforeHash?: string;
  afterHash?: string;
  mode?: number;
}

/** Changes a shell checkpoint saw but could not keep within its budget. */
export interface CheckpointGap {
  files: number;
  bytes: number;
  reason: string;
}

export interface Checkpoint {
  id: string;
  createdAt: string;
  label: string;
  tool: string;
  sessionId?: string;
  files: CheckpointFile[];
  bytes: number;
  finalizedAt?: string;
  /** Shell command that produced the changes, for bash, terminal and background jobs. */
  command?: string;
  /** Set when some changes were left out: too many files, too many bytes or out of time. */
  gap?: CheckpointGap;
}

export interface PreImageData {
  content: Uint8Array | string;
  mode?: number;
}

export type PreImage = PreImageData | null;

export type PreImageMap = Record<string, PreImage>;

export interface CaptureOptions {
  paths: string[];
  label: string;
  tool: string;
  sessionId?: string;
  preImages?: PreImageMap;
  afterImages?: PreImageMap;
  gap?: CheckpointGap;
  command?: string;
  signal?: AbortSignal;
}

export interface RecordAfterOptions {
  after?: PreImageMap;
  gap?: CheckpointGap;
  signal?: AbortSignal;
}

export interface RestoreOptions {
  signal?: AbortSignal;
  /** Overwrite files that were edited after the checkpoint. */
  force?: boolean;
  /** Also restore settings and secrets: flecten.config.json, .liquid/, .env files. */
  includeProtected?: boolean;
  /** Restore only these checkpoint paths. */
  paths?: string[];
}

export interface RestoreSkip {
  path: string;
  /** `conflict`: the file changed after the checkpoint. `protected`: settings or secrets. */
  reason: "conflict" | "protected";
}

export interface DiffOptions {
  signal?: AbortSignal;
}

export interface RestoreResult {
  id: string;
  target: CheckpointTarget;
  restored: string[];
  removed: string[];
  unchanged: string[];
  skipped: RestoreSkip[];
}

export interface CheckpointDiffFile {
  path: string;
  status: CheckpointChangeStatus;
  beforeHash?: string;
  afterHash?: string;
}

export interface CheckpointDiff {
  id: string;
  files: CheckpointDiffFile[];
}

export interface PruneOptions {
  keep?: number;
  maxAgeMs?: number;
  signal?: AbortSignal;
}

export interface PruneResult {
  removed: string[];
  objectsRemoved: number;
  bytesFreed: number;
}

export type CheckpointErrorCode =
  | "invalid_id"
  | "invalid_path"
  | "invalid_options"
  | "symlink"
  | "not_a_file"
  | "manifest_missing"
  | "manifest_invalid"
  | "object_missing"
  | "not_finalized";

export class CheckpointError extends Error {
  readonly code: CheckpointErrorCode;
  readonly path: string | undefined;

  constructor(
    code: CheckpointErrorCode,
    message: string,
    options: { path?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CheckpointError";
    this.code = code;
    this.path = options.path;
  }
}

export function symlinkError(path: string): CheckpointError {
  return new CheckpointError("symlink", `Refusing to follow symbolic link: ${path}`, { path });
}

export function notFileError(path: string): CheckpointError {
  return new CheckpointError("not_a_file", `Checkpoint path is not a regular file: ${path}`, {
    path,
  });
}

export function invalidPath(path: string): CheckpointError {
  return new CheckpointError("invalid_path", `Checkpoint path is outside the workspace: ${path}`, {
    path,
  });
}

export function missingObject(hash: string): CheckpointError {
  return new CheckpointError("object_missing", `Checkpoint object is missing: ${hash}`, {
    path: hash,
  });
}

export function assertPreImage(path: string, image: PreImage): void {
  if (image === null) return;
  const badContent = typeof image.content !== "string" && !(image.content instanceof Uint8Array);
  const badMode =
    image.mode !== undefined &&
    (!Number.isInteger(image.mode) || image.mode < 0 || image.mode > 0o777);
  if (badContent || badMode) {
    throw new CheckpointError("invalid_options", `Invalid pre-image for ${path}`, { path });
  }
}

export interface CheckpointStoreOptions {
  root?: string;
  cwd?: string;
}

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const dateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "invalid date",
});

const checkpointFileSchema = z.object({
  path: z.string().min(1),
  beforeHash: sha256Schema.optional(),
  afterHash: sha256Schema.optional(),
  mode: z.number().int().min(0).max(0o777).optional(),
});

export const checkpointSchema = z.object({
  id: z.string().regex(/^[\w-]+$/),
  createdAt: dateSchema,
  label: z.string().min(1),
  tool: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  files: z.array(checkpointFileSchema),
  bytes: z.number().int().nonnegative(),
  finalizedAt: dateSchema.optional(),
  command: z.string().optional(),
  gap: z
    .object({
      files: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      reason: z.string(),
    })
    .optional(),
});
