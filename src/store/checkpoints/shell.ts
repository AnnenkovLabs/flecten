import { lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  GITLINK_MODE,
  parseBatch,
  parseBatchCheck,
  parseRawDiff,
  SYMLINK_MODE,
  type TreeChange,
} from "./git-formats";
import type { Snapshot, WorkspaceSnapshots } from "./snapshots";
import type { CheckpointStore } from "./store";
import type { CheckpointGap, PreImageMap } from "./types";

/** Time a shell command may spend on its checkpoint: before, after and saving. 5 s in total. */
export const SHELL_CHECKPOINT_BUDGET = { beforeMs: 1500, afterMs: 1500, saveMs: 2000 } as const;

export interface ShellCheckpointLimits {
  maxFiles: number;
  maxBytes: number;
}

export const DEFAULT_SHELL_LIMITS: ShellCheckpointLimits = {
  maxFiles: 2000,
  maxBytes: 128 * 1024 * 1024,
};

export interface ShellCheckpointRequest {
  tool: string;
  label: string;
  command: string;
  sessionId: string;
  /** Ignored workspace paths the command deletes; captured on top of the usual snapshot. */
  include?: readonly string[];
}

export interface ShellCheckpointSummary {
  /** Checkpoint id when the command changed files. */
  id?: string;
  files: number;
  bytes: number;
  gap?: CheckpointGap;
  /** Why no checkpoint could be taken. */
  unavailable?: string;
  tookMs: number;
}

export interface ShellCheckpointHandle {
  finish(): Promise<ShellCheckpointSummary>;
}

/** Snapshots around shell commands, so bash, terminal and background jobs can be undone. */
export interface ShellCheckpoints {
  begin(request: ShellCheckpointRequest): Promise<ShellCheckpointHandle>;
  /** Ignored files under the paths: can a delete of them still be undone within the limits? */
  ignored(paths: readonly string[]): Promise<{ files: number; bytes: number; over: boolean }>;
  /** Undefined while snapshots work, otherwise the reason they are off. */
  status(): Promise<string | undefined>;
  readonly limits: ShellCheckpointLimits;
}

const EXECUTABLE_MODE = "100755";

const REASONS = {
  special: "ссылки и подмодули",
  stale: "файлы больше 16 МБ или недоступные",
  limit: "лимит файлов или объёма",
  time: "не уложились во время",
  missing: "объект снимка не найден",
} as const;

export class ShellCheckpointService implements ShellCheckpoints {
  readonly limits: ShellCheckpointLimits;
  readonly #snapshots: WorkspaceSnapshots;
  readonly #store: CheckpointStore;
  readonly #workTree: string;

  constructor(
    snapshots: WorkspaceSnapshots,
    store: CheckpointStore,
    limits: Partial<ShellCheckpointLimits> = {},
  ) {
    this.#snapshots = snapshots;
    this.#store = store;
    this.#workTree = snapshots.git.workTree;
    this.limits = { ...DEFAULT_SHELL_LIMITS, ...limits };
  }

  /** Waits for the first full capture: undefined when snapshots work, otherwise why not. */
  ready(): Promise<string | undefined> {
    return this.#snapshots.warm();
  }

  async status(): Promise<string | undefined> {
    const ready = await Promise.race([this.#snapshots.warm(), Bun.sleep(0).then(() => "pending")]);
    return ready === "pending" ? "первичная индексация рабочей папки ещё идёт" : ready;
  }

  async ignored(paths: readonly string[]) {
    const files = await this.#snapshots.ignoredFiles(
      paths,
      this.limits.maxFiles + 1,
      Date.now() + SHELL_CHECKPOINT_BUDGET.beforeMs,
    );
    let bytes = 0;
    for (const path of files) {
      const info = await lstat(join(this.#workTree, path)).catch(() => null);
      bytes += info?.size ?? 0;
    }
    return {
      files: files.length,
      bytes,
      over: files.length > this.limits.maxFiles || bytes > this.limits.maxBytes,
    };
  }

  async begin(request: ShellCheckpointRequest): Promise<ShellCheckpointHandle> {
    const started = Date.now();
    const before = await this.#snapshots.capture({
      deadline: started + SHELL_CHECKPOINT_BUDGET.beforeMs,
      ...(request.include ? { include: request.include } : {}),
    });
    return {
      finish: async () => {
        if (!before.ok)
          return { files: 0, bytes: 0, unavailable: before.reason, tookMs: before.tookMs };
        const finishStarted = Date.now();
        const after = await this.#snapshots.capture({
          deadline: finishStarted + SHELL_CHECKPOINT_BUDGET.afterMs,
        });
        const deadline =
          finishStarted + SHELL_CHECKPOINT_BUDGET.afterMs + SHELL_CHECKPOINT_BUDGET.saveMs;
        try {
          await this.#snapshots.release(before.snapshot, deadline);
        } catch {
          return {
            files: 0,
            bytes: 0,
            unavailable: REASONS.time,
            tookMs: before.snapshot.tookMs + (Date.now() - finishStarted),
          };
        }
        const spent = before.snapshot.tookMs;
        if (!after.ok) {
          return { files: 0, bytes: 0, unavailable: after.reason, tookMs: spent + after.tookMs };
        }
        const summary = await this.#record(before.snapshot, after.snapshot, request, deadline);
        return { ...summary, tookMs: spent + (Date.now() - finishStarted) };
      },
    };
  }

  async #record(
    before: Snapshot,
    after: Snapshot,
    request: ShellCheckpointRequest,
    deadline: number,
  ) {
    const gap = { files: 0, bytes: 0, reasons: new Set<string>() };
    for (const [path, stamp] of after.stale) {
      if (before.stale.get(path) === stamp) continue;
      gap.files += 1;
      gap.reasons.add(REASONS.stale);
    }
    if (before.tree === after.tree) return this.#finish(undefined, gap);
    const diff = await this.#snapshots.git.run(
      ["diff-tree", "-r", "-z", "--raw", "--no-renames", before.tree, after.tree],
      { deadline },
    );
    if (diff.code !== 0 || diff.timedOut) {
      gap.reasons.add(REASONS.time);
      return this.#finish(undefined, gap);
    }
    const kept = this.#regular(parseRawDiff(diff.stdout), before, after, gap);
    const chosen = await this.#withinLimits(kept, gap, deadline);
    if (chosen.length === 0) return this.#finish(undefined, gap);
    const ids = [...new Set(chosen.flatMap((change) => [change.beforeId, change.afterId]))].filter(
      (id): id is string => id !== undefined,
    );
    const batch = await this.#snapshots.git.run(["cat-file", "--batch"], {
      input: `${ids.join("\n")}\n`,
      deadline,
    });
    if (batch.code !== 0 || batch.timedOut) {
      gap.files += chosen.length;
      gap.reasons.add(REASONS.time);
      return this.#finish(undefined, gap);
    }
    const blobs = parseBatch(batch.stdout);
    const preImages: PreImageMap = {};
    const afterImages: PreImageMap = {};
    const paths: string[] = [];
    for (const change of chosen) {
      const missing = [change.beforeId, change.afterId].some(
        (id) => id !== undefined && !blobs.has(id),
      );
      if (missing) {
        gap.files += 1;
        gap.reasons.add(REASONS.missing);
        continue;
      }
      preImages[change.path] = image(blobs, change.beforeId, change.beforeMode);
      afterImages[change.path] = image(blobs, change.afterId, change.afterMode);
      paths.push(change.path);
    }
    if (paths.length === 0) return this.#finish(undefined, gap);
    const gapValue = gapOf(gap);
    const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
    try {
      const saved = await this.#store.capture({
        paths,
        label: request.label,
        tool: request.tool,
        sessionId: request.sessionId,
        command: request.command,
        preImages,
        afterImages,
        signal,
        ...(gapValue ? { gap: gapValue } : {}),
      });
      return this.#finish(saved, gap);
    } catch (error) {
      if (!signal.aborted) throw error;
      gap.files += paths.length;
      gap.reasons.add(REASONS.time);
      return this.#finish(undefined, gap);
    }
  }

  #regular(
    changes: TreeChange[],
    before: Snapshot,
    after: Snapshot,
    gap: { files: number; reasons: Set<string> },
  ): TreeChange[] {
    return changes.filter((change) => {
      const special = [change.beforeMode, change.afterMode].some(
        (mode) => mode === SYMLINK_MODE || mode === GITLINK_MODE,
      );
      if (special) {
        gap.files += 1;
        gap.reasons.add(REASONS.special);
        return false;
      }
      // A path stale on either side has no trustworthy content for that side.
      return !before.stale.has(change.path) && !after.stale.has(change.path);
    });
  }

  async #withinLimits(
    changes: TreeChange[],
    gap: { files: number; bytes: number; reasons: Set<string> },
    deadline: number,
  ): Promise<TreeChange[]> {
    const ids = [...new Set(changes.flatMap((change) => [change.beforeId, change.afterId]))].filter(
      (id): id is string => id !== undefined,
    );
    if (ids.length === 0) return changes;
    const check = await this.#snapshots.git.run(["cat-file", "--batch-check"], {
      input: `${ids.join("\n")}\n`,
      deadline,
    });
    if (check.code !== 0 || check.timedOut) {
      gap.files += changes.length;
      gap.reasons.add(REASONS.time);
      return [];
    }
    const sizes = parseBatchCheck(check.stdout);
    const sorted = [...changes].sort((left, right) => left.path.localeCompare(right.path));
    const chosen: TreeChange[] = [];
    let bytes = 0;
    for (const change of sorted) {
      const size =
        (change.beforeId ? (sizes.get(change.beforeId) ?? 0) : 0) +
        (change.afterId ? (sizes.get(change.afterId) ?? 0) : 0);
      if (chosen.length >= this.limits.maxFiles || bytes + size > this.limits.maxBytes) {
        gap.files += 1;
        gap.bytes += size;
        gap.reasons.add(REASONS.limit);
        continue;
      }
      chosen.push(change);
      bytes += size;
    }
    return chosen;
  }

  #finish(
    saved: Awaited<ReturnType<CheckpointStore["recordAfter"]>> | undefined,
    gap: { files: number; bytes: number; reasons: Set<string> },
  ): Omit<ShellCheckpointSummary, "tookMs"> {
    const value = gapOf(gap);
    return {
      ...(saved ? { id: saved.id } : {}),
      files: saved?.files.length ?? 0,
      bytes: saved?.bytes ?? 0,
      ...(value ? { gap: value } : {}),
    };
  }
}

function image(blobs: Map<string, Buffer>, id: string | undefined, mode: string) {
  const content = id === undefined ? undefined : blobs.get(id);
  if (content === undefined) return null;
  return { content, mode: mode === EXECUTABLE_MODE ? 0o755 : 0o644 };
}

function gapOf(gap: {
  files: number;
  bytes: number;
  reasons: Set<string>;
}): CheckpointGap | undefined {
  if (gap.files === 0 && gap.reasons.size === 0) return undefined;
  return { files: gap.files, bytes: gap.bytes, reason: [...gap.reasons].join(", ") };
}
