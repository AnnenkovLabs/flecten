import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { ProjectLockedError } from "../errors";
import { projectPaths } from "../store/paths";
import { isObject } from "../util/json";

/** How long a starting core waits for the previous core of the project to let go, in ms. */
export const LOCK_WAIT_MS = 5_000;
const POLL_MS = 100;

/** The project folder takes no lock file: the core runs unlocked rather than not at all. */
const UNLOCKABLE = new Set(["EACCES", "EPERM", "EROFS", "ENOTSUP", "ENOSYS"]);

const HolderSchema = z.object({
  pid: z.number().int().positive(),
  token: z.string().min(1),
  startedAt: z.string(),
});

type Holder = z.infer<typeof HolderSchema>;

export interface ProjectLock {
  /** The lock file, or null when the project folder could not take one. */
  readonly path: string | null;
  /** Removes the lock while this core still holds it. Synchronous, so it also runs on `exit`. */
  release(): void;
}

function codeOf(error: unknown): string {
  return isObject(error) && typeof error.code === "string" ? error.code : "";
}

/** A lock file that does not parse is not a live core's lock: every lock is written whole. */
function parseHolder(text: string): Holder | null {
  try {
    const parsed = HolderSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Signal 0 only asks whether the process exists; EPERM means it does, under another user. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
}

/**
 * A lock with this process's pid and another token is left by an earlier core that had the
 * same pid, as a container restart gives; any other holder counts while its process lives.
 */
function holds(holder: Holder | null): holder is Holder {
  return holder !== null && holder.pid !== process.pid && alive(holder.pid);
}

/** Publishes a whole lock file in one step: a hard link fails when the name is taken. */
async function create(path: string, self: Holder): Promise<boolean> {
  const temp = `${path}.${self.token}.tmp`;
  await writeFile(temp, JSON.stringify(self), { mode: 0o600 });
  try {
    await link(temp, path);
    return true;
  } catch (error) {
    if (codeOf(error) === "EEXIST") return false;
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}

/**
 * Moves a dead core's lock aside and checks it is the lock that was judged dead: a lock
 * another core published in between goes back under its name.
 */
async function takeOver(path: string, stale: Holder | null): Promise<void> {
  const aside = `${path}.${randomUUID()}.stale`;
  try {
    await rename(path, aside);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return;
    throw error;
  }
  const moved = parseHolder(await readFile(aside, "utf8").catch(() => ""));
  if (moved !== null && moved.token !== stale?.token) {
    await link(aside, path).catch(() => undefined);
  }
  await rm(aside, { force: true });
}

function held(path: string, token: string): ProjectLock {
  let released = false;
  return {
    path,
    release() {
      if (released) return;
      released = true;
      try {
        if (parseHolder(readFileSync(path, "utf8"))?.token === token) rmSync(path, { force: true });
      } catch {
        // The lock is already gone: nothing of this core is left to remove.
      }
    },
  };
}

/**
 * Makes this core the only one that writes the project's sessions, queue and checkpoints.
 * A live holder gets `waitMs` to let go (a reopened project restarts its core), a dead one
 * loses the lock at once. A read-only project runs unlocked.
 */
export async function lockProject(root: string, waitMs = LOCK_WAIT_MS): Promise<ProjectLock> {
  const { liquid, lock: path } = projectPaths(root);
  const self: Holder = {
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
  };
  const deadline = Date.now() + waitMs;
  try {
    await mkdir(liquid, { recursive: true });
    for (;;) {
      if (await create(path, self)) return held(path, self.token);
      const text = await readFile(path, "utf8").catch(() => null);
      if (text === null) continue;
      const holder = parseHolder(text);
      if (!holds(holder)) {
        // ponytail: a core that starts during another core's takeover may share the lock; one app instance makes that moot.
        await takeOver(path, holder);
        continue;
      }
      if (Date.now() >= deadline) throw new ProjectLockedError(holder.pid, path);
      await sleep(POLL_MS);
    }
  } catch (error) {
    if (UNLOCKABLE.has(codeOf(error))) return { path: null, release: () => undefined };
    throw error;
  }
}
