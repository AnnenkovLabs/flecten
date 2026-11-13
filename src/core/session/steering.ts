import { withAttachmentBlocks } from "../attachments";
import { contextReferenceBlocks } from "../context-reference";
import type { SteeringMessage } from "../loop/types";
import type { QueueItem } from "../queue/types";
import { sessionAttachments } from "./media";
import type { SessionOptions } from "./options";

export async function prepareSteering(
  items: QueueItem[],
  sessionId: string,
  options: SessionOptions,
): Promise<SteeringMessage[]> {
  return Promise.all(
    items.map(async (item) => {
      const loaded = await sessionAttachments(
        item.attachments ?? [],
        sessionId,
        options,
        item.attachmentSnapshot,
      );
      return {
        text: withAttachmentBlocks(item.text, [
          ...loaded.blocks,
          ...contextReferenceBlocks(item.contexts ?? []),
        ]),
        display: item.text,
        queueId: item.id,
        ...(loaded.parts.length ? { attachments: loaded.parts } : {}),
        ...(loaded.media.length ? { attachmentRefs: loaded.media } : {}),
      };
    }),
  );
}
