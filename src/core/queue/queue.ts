import { HarnessError } from "../../errors";
import { newId } from "../../util/ids";
import type { AttachmentSnapshot } from "../attachment-reference";
import type { ContextReference } from "../context-reference";
import {
  type QueueItem,
  type QueueItemMode,
  QueueItemSchema,
  type SerializedQueue,
  SerializedQueueSchema,
} from "./types";

function copy(item: QueueItem): QueueItem {
  return {
    ...item,
    ...(item.attachments ? { attachments: [...item.attachments] } : {}),
    ...(item.attachmentSnapshot
      ? {
          attachmentSnapshot: {
            media: item.attachmentSnapshot.media.map((ref) => ({ ...ref })),
            blocks: [...item.attachmentSnapshot.blocks],
          },
        }
      : {}),
    ...(item.contexts ? { contexts: item.contexts.map((context) => ({ ...context })) } : {}),
  };
}

function stateError(id: string, state: QueueItem["state"], action: string): HarnessError {
  return new HarnessError("invalid_input", `cannot ${action} queue item ${id} in state ${state}`);
}

export class RunQueue {
  private items: QueueItem[] = [];

  static restore(serialized: unknown): RunQueue {
    const data = SerializedQueueSchema.parse(serialized);
    const queue = new RunQueue();
    queue.items = data.items.map(copy);
    return queue;
  }

  /** Adds an item; with a client id the same message sent twice stays one item. */
  add(
    text: string,
    mode: QueueItemMode = "queue",
    attachments?: string[],
    id?: string,
    contexts?: ContextReference[],
    attachmentSnapshot?: AttachmentSnapshot,
  ): QueueItem {
    const existing = id === undefined ? undefined : this.items.find((entry) => entry.id === id);
    if (existing) return copy(existing);
    const item = QueueItemSchema.parse({
      id: id ?? newId("q"),
      text,
      mode,
      createdAt: Date.now(),
      state: "pending",
      ...(attachments ? { attachments: [...attachments] } : {}),
      ...(contexts ? { contexts } : {}),
      ...(attachmentSnapshot ? { attachmentSnapshot } : {}),
    });
    this.items.push(item);
    return copy(item);
  }

  edit(id: string, text: string): QueueItem {
    const item = this.find(id);
    if (item.state !== "pending") throw stateError(id, item.state, "edit");
    const next = QueueItemSchema.parse({ ...item, text });
    Object.assign(item, next);
    return copy(next);
  }

  remove(id: string): QueueItem {
    const item = this.find(id);
    if (item.state === "sending") throw stateError(id, item.state, "remove");
    this.items = this.items.filter((entry) => entry.id !== id);
    return copy(item);
  }

  list(): QueueItem[] {
    return this.items.map(copy);
  }

  takeNext(): QueueItem | undefined {
    const next = this.items.find((item) => item.mode === "queue" && item.state === "pending");
    if (!next) return undefined;
    return this.markSending(next.id);
  }

  markSending(id: string): QueueItem {
    const item = this.find(id);
    if (item.state !== "pending") throw stateError(id, item.state, "send");
    item.state = "sending";
    return copy(item);
  }

  markSent(id: string): QueueItem {
    const item = this.find(id);
    if (item.state !== "sending") throw stateError(id, item.state, "mark sent");
    item.state = "sent";
    return copy(item);
  }

  markCancelled(id: string): QueueItem {
    const item = this.find(id);
    if (item.state !== "pending" && item.state !== "sending") {
      throw stateError(id, item.state, "cancel");
    }
    item.state = "cancelled";
    return copy(item);
  }

  /** Items that still matter after a restart: sent and cancelled ones are dropped. */
  serialize(): SerializedQueue {
    const open = this.items.filter((item) => item.state === "pending" || item.state === "sending");
    return { version: 1, items: open.map(copy) };
  }

  private find(id: string): QueueItem {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new HarnessError("invalid_input", `queue item not found: ${id}`);
    return item;
  }
}
