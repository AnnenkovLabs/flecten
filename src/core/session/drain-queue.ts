import type { QueueItem, QueueItemMode } from "../queue/types";
import type { RunResult, SessionId } from "../types";
import { failureEvent, messageOf } from "./failure";
import type { SessionOptions } from "./options";
import type { RunExtras, SessionRuntime } from "./runtime";

export function followUpMode(
  reason: RunResult["stopReason"],
  role: SessionOptions["role"],
  summaryWake: boolean,
): QueueItemMode | "any" | undefined {
  if (summaryWake && reason === "max_turns") return "any";
  if (reason === "done" || reason === "end")
    return role === "talker" || summaryWake ? "any" : "queue";
  if (role === "talker" && reason === "max_turns") return "steer";
}

/** Transfer an undelivered queue item to a fresh turn without exposing an async idle gap. */
export function drainQueue(
  runtime: SessionRuntime,
  sessionId: SessionId,
  mode: QueueItemMode | "any",
  run: (item: QueueItem, extras: RunExtras) => Promise<RunResult>,
): Promise<RunResult | undefined> | undefined {
  if (runtime.busy()) return;
  const next = runtime.queue.takeNext(mode);
  if (!next) return;
  runtime.steering.push(next);
  void runtime.saveQueue();
  return run(next, {
    queueId: next.id,
    ...(next.actor ? { actor: next.actor } : {}),
    ...(next.attachmentSnapshot ? { attachmentSnapshot: next.attachmentSnapshot } : {}),
    ...(next.contexts ? { contexts: next.contexts } : {}),
  }).catch((error: unknown) => {
    if (runtime.queue.list().some((item) => item.id === next.id && item.state === "sending")) {
      runtime.queue.markCancelled(next.id);
      void runtime.saveQueue();
    }
    runtime.emit(failureEvent(sessionId, error, messageOf(error)));
    return undefined;
  });
}
