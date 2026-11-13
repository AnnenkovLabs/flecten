import { rm } from "node:fs/promises";
import type { SerializedQueue } from "../core/queue/types";
import { SerializedQueueSchema } from "../core/queue/types";
import { atomicWrite } from "../util/atomic";
import { readTolerant } from "./events/envelope";
import { sessionPaths } from "./paths";

/** Queue of a session as saved on disk, or undefined when there is none or it is unreadable. */
export async function loadQueue(
  cwd: string,
  sessionId: string,
): Promise<SerializedQueue | undefined> {
  const file = Bun.file(sessionPaths(cwd, sessionId).queue);
  if (!(await file.exists())) return undefined;
  try {
    const parsed = SerializedQueueSchema.safeParse(await file.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Atomic write: a crash in the middle leaves the previous queue, never half a file. */
export async function saveQueue(
  cwd: string,
  sessionId: string,
  queue: SerializedQueue,
): Promise<void> {
  const path = sessionPaths(cwd, sessionId).queue;
  if (queue.items.length === 0) {
    await rm(path, { force: true });
    return;
  }
  await atomicWrite(path, `${JSON.stringify(queue)}\n`);
}

/** Queue ids whose message reached the model, read from the session log. */
export async function deliveredQueueIds(cwd: string, sessionId: string): Promise<Set<string>> {
  const { envelopes } = await readTolerant(sessionPaths(cwd, sessionId).events);
  const ids = new Set<string>();
  for (const { event } of envelopes) {
    if ((event.type === "session.started" || event.type === "steer.applied") && event.queueId) {
      ids.add(event.queueId);
    }
  }
  return ids;
}

/**
 * The queue to give a restored session: items the log shows as delivered are dropped,
 * items that were mid-send go back to pending, so nothing is lost and nothing goes twice.
 */
export async function restoredQueue(
  cwd: string,
  sessionId: string,
): Promise<SerializedQueue | undefined> {
  const saved = await loadQueue(cwd, sessionId);
  if (!saved || saved.items.length === 0) return undefined;
  const delivered = await deliveredQueueIds(cwd, sessionId);
  const items = saved.items.flatMap((item) => {
    if (delivered.has(item.id)) return [];
    return [item.state === "sending" ? { ...item, state: "pending" as const } : item];
  });
  return items.length === 0 ? undefined : { version: 1, items };
}
