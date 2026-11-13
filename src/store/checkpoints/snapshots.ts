import { existsSync } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { abortable } from "../../util/abort";
import { Mutex } from "../../util/mutex";
import { attributedPaths, nulInput, nulList } from "./git-formats";
import { findUserRepo, ShadowGit } from "./shadow-git";

export interface SnapshotLimits {
  /** Files above this size are not snapshotted; their changes are reported as a gap. */
  maxFileBytes: number;
  /** Paths per update-index call, so one call never holds the index lock for long. */
  chunkPaths: number;
  /** Loose objects above this size make the next warm-up rebuild the shadow repository. */
  maxShadowBytes: number;
}

const LSTAT_BATCH = 256;

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxFileBytes: 16 * 1024 * 1024,
  chunkPaths: 2000,
  maxShadowBytes: 1024 * 1024 * 1024,
};

/** One captured state of the workspace. */
export interface Snapshot {
  tree: string;
  /**
   * Paths this tree may not reflect (too large, not a regular file, unreadable or out of time),
   * with `size:mtime` of what was on disk, so a later capture can tell whether they changed.
   */
  stale: ReadonlyMap<string, string>;
  /** Ignored files added for this capture only; `release` drops them from the index. */
  forced: readonly string[];
  tookMs: number;
}

export type SnapshotResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; reason: string; tookMs: number };

export interface CaptureRequest {
  /** Epoch ms. The capture gives up instead of running past it. */
  deadline: number;
  /** Ignored files that must be captured too, as `rm -rf build` targets. */
  include?: readonly string[];
}

/**
 * Workspace snapshots for shell checkpoints, independent of the user's git state. Each capture
 * asks git which files changed since the previous capture (stat cache in a private index) and
 * hashes only those, so the cost follows the change, not the size of the repository.
 */
export class WorkspaceSnapshots {
  readonly #git: ShadowGit;
  readonly #limits: SnapshotLimits;
  readonly #mutex = new Mutex();
  #ready: Promise<string | undefined> | undefined;
  #tree: string | undefined;
  #dirty = true;

  constructor(workTree: string, stateDir: string, limits: Partial<SnapshotLimits> = {}) {
    this.#git = new ShadowGit(workTree, stateDir);
    this.#limits = { ...DEFAULT_SNAPSHOT_LIMITS, ...limits };
  }

  get git(): ShadowGit {
    return this.#git;
  }

  /** Starts the one-time setup and first full capture in the background. */
  warm(): Promise<string | undefined> {
    this.#ready ??= this.#mutex
      .run(() => this.#setup())
      .catch((error: unknown) => {
        return error instanceof Error ? error.message : String(error);
      });
    return this.#ready;
  }

  async capture(request: CaptureRequest): Promise<SnapshotResult> {
    const started = Date.now();
    const failure = (reason: string): SnapshotResult => ({
      ok: false,
      reason,
      tookMs: Date.now() - started,
    });
    const wait = request.deadline - Date.now();
    const setup = await Promise.race([
      this.warm(),
      Bun.sleep(Math.max(0, wait)).then(() => "timeout" as const),
    ]);
    if (setup === "timeout") return failure("первичная индексация рабочей папки ещё идёт");
    if (setup !== undefined) return failure(setup);
    const signal = AbortSignal.timeout(Math.max(1, request.deadline - Date.now()));
    return this.#mutex
      .run(async () => {
        const forced = request.include?.length
          ? await this.#ignoredUnder(request.include, request.deadline)
          : [];
        const scan = await this.#scan(request.deadline);
        if (scan === undefined) return failure("не уложились во время на проверку файлов");
        const stale = await this.#update([...new Set([...scan, ...forced])], request.deadline);
        const tree = await this.#writeTree(request.deadline);
        if (tree === undefined) return failure("не удалось записать снимок");
        return {
          ok: true,
          snapshot: { tree, stale, forced, tookMs: Date.now() - started },
        } satisfies SnapshotResult;
      }, signal)
      .catch((error: unknown) => {
        if (signal.aborted) return failure("не уложились во время ожидания снимка");
        throw error;
      });
  }

  /** Drops the ignored files a capture added, so the private index stays as small as git's. */
  async release(snapshot: Snapshot, deadline = Date.now() + 1500): Promise<void> {
    if (snapshot.forced.length === 0) return;
    const cleanup = this.#mutex.run(async () => {
      await this.#git.run(["update-index", "--force-remove", "-z", "--stdin"], {
        input: nulInput(snapshot.forced),
        deadline: Date.now() + 1500,
      });
      this.#dirty = true;
    });
    await abortable(cleanup, AbortSignal.timeout(Math.max(1, deadline - Date.now())));
  }

  /** Ignored files under workspace-relative paths, up to `limit` entries. */
  async ignoredFiles(paths: readonly string[], limit: number, deadline: number): Promise<string[]> {
    return this.#mutex.run(() => this.#ignoredUnder(paths, deadline, limit));
  }

  async #setup(): Promise<string | undefined> {
    if (!(await this.#git.ensure())) return "git недоступен, снимки shell-команд выключены";
    if (await this.#oversized()) {
      await rm(this.#git.gitDir, { recursive: true, force: true });
      if (!(await this.#git.ensure())) return "не удалось пересоздать теневой репозиторий";
    }
    const user = await findUserRepo(this.#git.workTree);
    await this.#git.linkObjects(user ? join(user.commonDir, "objects") : undefined);
    await this.#git.writeExcludes(user?.commonDir, ["/.liquid/"]);
    await this.#git.clearLock();
    const userIndex = user ? join(user.gitDir, "index") : undefined;
    if (
      !existsSync(this.#git.indexFile) &&
      user &&
      !user.converts &&
      userIndex &&
      existsSync(userIndex)
    ) {
      await this.#git.seedIndex(userIndex);
      await this.#dropConverted(user.gitDir);
    }
    const scan = await this.#scan(undefined);
    if (scan === undefined) return "не удалось прочитать список файлов рабочей папки";
    await this.#update(scan, undefined);
    const tree = await this.#writeTree(undefined);
    return tree === undefined ? "не удалось записать первый снимок" : undefined;
  }

  async #oversized(): Promise<boolean> {
    const out = await this.#git.run(["count-objects", "-v"]);
    if (out.code !== 0) return false;
    for (const line of out.stdout.toString("utf8").split("\n")) {
      const [key, value] = line.split(": ");
      if (key === "size" && Number(value) * 1024 > this.#limits.maxShadowBytes) return true;
    }
    return false;
  }

  /**
   * A copied index entry is a valid cache only when git stored the file byte for byte. Entries
   * the user's attributes convert (line endings, LFS and other filters) are dropped and hashed raw.
   */
  async #dropConverted(userGitDir: string): Promise<void> {
    const listed = await this.#git.run(["ls-files", "-z"]);
    if (listed.code !== 0) return;
    const attrs = await this.#git.run(
      [
        "--git-dir",
        userGitDir,
        "check-attr",
        "-z",
        "--stdin",
        "text",
        "eol",
        "filter",
        "ident",
        "working-tree-encoding",
      ],
      { input: listed.stdout },
    );
    const converted =
      attrs.code === 0 ? [...attributedPaths(attrs.stdout)] : nulList(listed.stdout);
    if (converted.length === 0) return;
    await this.#git.run(["update-index", "--force-remove", "-z", "--stdin"], {
      input: nulInput(converted),
    });
    this.#dirty = true;
  }

  /** Changed, deleted and new files relative to the private index, honoring .gitignore. */
  async #scan(deadline: number | undefined): Promise<string[] | undefined> {
    const out = await this.#git.run(["ls-files", "-z", "-m", "-d", "-o", "--exclude-standard"], {
      ...(deadline === undefined ? {} : { deadline }),
    });
    if (out.code !== 0 || out.timedOut) return undefined;
    return [...new Set(nulList(out.stdout))];
  }

  async #ignoredUnder(
    paths: readonly string[],
    deadline: number,
    limit = 100_000,
  ): Promise<string[]> {
    const out = await this.#git.run(
      ["ls-files", "-z", "-o", "-i", "--exclude-standard", "--", ...paths],
      { deadline, maxOutputBytes: limit * 256 },
    );
    if (out.timedOut) return [];
    return nulList(out.stdout).slice(0, limit);
  }

  /** Hashes the listed paths into the index; returns the paths left stale. */
  async #update(
    paths: readonly string[],
    deadline: number | undefined,
  ): Promise<Map<string, string>> {
    const stale = new Map<string, string>();
    const ready: string[] = [];
    const stamps = new Map<string, string>();
    for (let start = 0; start < paths.length; start += LSTAT_BATCH) {
      const batch = paths.slice(start, start + LSTAT_BATCH);
      const infos = await Promise.all(
        batch.map((path) =>
          path.endsWith("/") ? null : lstat(join(this.#git.workTree, path)).catch(() => null),
        ),
      );
      for (const [index, path] of batch.entries()) {
        const info = infos[index];
        const stamp = info ? `${info.size}:${info.mtimeMs}` : "missing";
        stamps.set(path, stamp);
        if (path.endsWith("/")) stale.set(path, stamp);
        else if (info && (!info.isFile() || info.size > this.#limits.maxFileBytes)) {
          stale.set(path, stamp);
        } else ready.push(path);
      }
    }
    for (let start = 0; start < ready.length; start += this.#limits.chunkPaths) {
      const chunk = ready.slice(start, start + this.#limits.chunkPaths);
      if (deadline !== undefined && Date.now() >= deadline) {
        for (const path of ready.slice(start)) stale.set(path, stamps.get(path) ?? "missing");
        break;
      }
      const out = await this.#git.run(["update-index", "--add", "--remove", "-z", "--stdin"], {
        input: nulInput(chunk),
        ...(deadline === undefined ? {} : { deadline }),
      });
      if (out.code !== 0 || out.timedOut) {
        await this.#git.clearLock();
        for (const path of chunk) stale.set(path, stamps.get(path) ?? "missing");
        continue;
      }
      this.#dirty = true;
    }
    return stale;
  }

  async #writeTree(deadline: number | undefined): Promise<string | undefined> {
    if (!this.#dirty && this.#tree !== undefined) return this.#tree;
    const out = await this.#git.run(["write-tree", "--missing-ok"], {
      ...(deadline === undefined ? {} : { deadline }),
    });
    if (out.code !== 0 || out.timedOut) return undefined;
    this.#tree = out.stdout.toString("utf8").trim();
    this.#dirty = false;
    return this.#tree;
  }
}
