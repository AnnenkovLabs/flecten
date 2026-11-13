import type { Command, Event } from "./types";

export type Listener = (event: Event) => void;

export interface HarnessService {
  send(command: Command): Promise<unknown>;
  subscribe(listener: Listener): () => void;
}
