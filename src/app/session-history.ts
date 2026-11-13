import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessConfig } from "../config/schema";
import { deleteSession, isValidSessionId, listSessions } from "../store/events/index";
import { loadQueue } from "../store/queue";

const DAY_MS = 86_400_000;

/** Retention archives finished tasks first; only already archived tasks expire permanently. */
export async function maintainSessionHistory(
  cwd: string,
  policy: HarnessConfig["sessions"],
  protectedSession: (id: string) => boolean,
  closeSession: (id: string) => Promise<void>,
  now = Date.now(),
  storage?: Pick<import("./session-storage").SessionStorage, "list" | "delete">,
): Promise<void> {
  if (!policy) return;
  const sessions = await (storage ? storage.list() : listSessions(cwd));
  const cutoff = now - policy.retentionDays * DAY_MS;
  for (const [index, session] of sessions.entries()) {
    if (session.running || session.interrupted || protectedSession(session.id)) continue;
    if (index < policy.maxSessions && Date.parse(session.updatedAt) >= cutoff) continue;
    if ((await loadQueue(cwd, session.id))?.items.length) continue;
    await closeSession(session.id);
    if (!protectedSession(session.id))
      await (storage ? storage.delete(session.id) : deleteSession(cwd, session.id));
  }

  const trashRoot = join(cwd, ".liquid", "trash");
  const trashCutoff = now - policy.trashDays * DAY_MS;
  const trash = await readdir(trashRoot, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  for (const entry of trash) {
    if (!entry.isDirectory() || !isValidSessionId(entry.name)) continue;
    const path = join(trashRoot, entry.name);
    if ((await stat(path)).mtimeMs < trashCutoff) await rm(path, { recursive: true });
  }
}

/** Owns retention serialization and the same backend used by live sessions. */
export function sessionRetention(
  cwd: string,
  policy: () => HarnessConfig["sessions"],
  pool: import("./session-pool").SessionPool,
  storage: import("./session-storage").SessionStorage,
  forget: (id: string) => void,
) {
  let pending: Promise<void> = Promise.resolve();
  return {
    maintain() {
      const busy = (id: string) =>
        pool
          .activity()
          .some(
            (task) =>
              task.sessionId === id &&
              (task.running || task.queue > 0 || task.jobs > 0 || task.approvals > 0),
          );
      pending = pending
        .catch(() => undefined)
        .then(() =>
          maintainSessionHistory(
            cwd,
            policy(),
            busy,
            async (id) => {
              await pool.close(id);
              await storage.close(id);
              forget(id);
            },
            undefined,
            storage,
          ),
        );
      return pending;
    },
    settled: () => pending.catch(() => undefined),
  };
}
