import type { SteeringMessage } from "../loop/types";
import type { QueueItem } from "../queue/types";
import { sessionAttachments } from "./media";
import type { SessionOptions } from "./options";
import { withRunContext } from "./run-input";
import type { SessionRuntime } from "./runtime";

export async function takeSessionSteering(
  runtime: SessionRuntime,
  notices: SteeringMessage[],
): Promise<SteeringMessage[]> {
  const items = runtime.steering.takeAtBoundary();
  for (const item of items) runtime.queue.markSending(item.id);
  if (items.length > 0) await runtime.saveQueue();
  try {
    const typed = await prepareSteering(items, runtime.sessionId() ?? "", runtime.options);
    return [...((await runtime.options.takeNotices?.()) ?? []), ...notices, ...typed];
  } catch (error) {
    let changed = false;
    for (const item of items) {
      if (runtime.queue.list().some((entry) => entry.id === item.id && entry.state === "sending")) {
        runtime.queue.markCancelled(item.id);
        changed = true;
      }
    }
    if (changed) await runtime.saveQueue();
    throw error;
  }
}

async function prepareSteering(
  items: QueueItem[],
  sessionId: string,
  options: SessionOptions,
): Promise<SteeringMessage[]> {
  return Promise.all(
    items.map(async (item, index) => {
      const loaded = await sessionAttachments(
        item.attachments ?? [],
        sessionId,
        options,
        item.attachmentSnapshot,
      );
      const summary =
        index === 0 && options.role !== "worker"
          ? options.takeSummaryContext?.(sessionId)
          : undefined;
      const contexts = summary ? [...(item.contexts ?? []), summary] : (item.contexts ?? []);
      return {
        text: withRunContext(item.text, loaded.blocks, contexts),
        display: item.text,
        queueId: item.id,
        ...(item.actor ? { actor: item.actor } : {}),
        ...(loaded.parts.length ? { attachments: loaded.parts } : {}),
        ...(loaded.media.length ? { attachmentRefs: loaded.media } : {}),
        ...(loaded.blocks.length || loaded.media.length
          ? { attachmentSnapshot: loaded.snapshot }
          : {}),
        ...(item.contexts?.length ? { contexts: item.contexts } : {}),
      };
    }),
  );
}
