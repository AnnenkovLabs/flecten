import type { ThreadAnchor } from "./thread-window";

export interface ThreadPosition {
  top: number;
  atEnd: boolean;
  seenMessages: number;
  anchor?: ThreadAnchor;
}

const positions = new Map<string, ThreadPosition>();

export function threadPosition(taskId: string): ThreadPosition | undefined {
  return positions.get(taskId);
}

export function saveThreadPosition(taskId: string, position: ThreadPosition): void {
  if (taskId) positions.set(taskId, { ...position });
}

/** Following the end is an intention, not a fixed pixel offset, while the task keeps working. */
export function restoredThreadTop(
  position: ThreadPosition | undefined,
  scrollHeight: number,
  clientHeight: number,
): number {
  const end = Math.max(0, scrollHeight - clientHeight);
  return !position || position.atEnd ? end : Math.max(0, Math.min(end, position.top));
}

/** Returns true when a wheel gesture is still scrolling a nested overflow region inside the thread. */
export function isInnerScrollable(
  scroller: HTMLElement,
  target: EventTarget | null,
  deltaY: number,
): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== scroller) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        if (deltaY < 0 && node.scrollTop > 0) return true;
        if (deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}
