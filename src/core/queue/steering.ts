import type { QueueItem } from "./types";

function copy(item: QueueItem): QueueItem {
  return {
    ...item,
    ...(item.attachments ? { attachments: [...item.attachments] } : {}),
    ...(item.contexts ? { contexts: item.contexts.map((context) => ({ ...context })) } : {}),
  };
}

export class SteeringController {
  private pending: QueueItem[] = [];
  private seen = new Set<string>();

  push(item: QueueItem): boolean {
    if (item.mode !== "steer") return false;
    if (this.seen.has(item.id)) return false;
    const index = this.pending.findIndex((entry) => entry.id === item.id);
    if (item.state !== "pending") {
      if (index >= 0) this.pending.splice(index, 1);
      return false;
    }
    if (index >= 0) {
      this.pending[index] = copy(item);
      return false;
    }
    this.pending.push(copy(item));
    return true;
  }

  takeAtBoundary(): QueueItem[] {
    const taken = this.pending;
    this.pending = [];
    for (const item of taken) this.seen.add(item.id);
    return taken;
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  clear(): void {
    this.pending = [];
    this.seen.clear();
  }
}
