import type { Listener } from "../service";
import type { Event } from "../types";

export interface EventBus {
  emit(event: Event): void;
  subscribe(listener: Listener): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Set<Listener>();

  return {
    emit(event: Event): void {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {}
      }
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
