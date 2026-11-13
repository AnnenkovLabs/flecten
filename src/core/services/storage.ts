import type { Event, RunStopReason, SessionId } from "../types";

export interface SessionSummary {
  id: string;
  title: string;
  project: string;
  createdAt: string;
  updatedAt: string;
  stopReason?: RunStopReason | undefined;
  running?: boolean | undefined;
  interrupted?: boolean | undefined;
  messageCount: number;
  tokens?: number | undefined;
  lastPrompt: string;
}
export interface SessionListOptions {
  query?: string;
  limit?: number;
  offset?: number;
}
export interface ForkSessionOptions {
  sequence?: number;
  turn?: number;
  title?: string;
}
export interface EventEnvelope {
  seq: number;
  ts: string;
  schemaVersion: number;
  sessionId: SessionId;
  event: Event;
}
/** Journal and index backend. Media, checkpoints and queue files remain workspace-owned. */
export type StorageRequest =
  | { operation: "append"; event: Event }
  | { operation: "read"; sessionId: string }
  | { operation: "list"; options: SessionListOptions }
  | { operation: "rename"; sessionId: string; title: string }
  | { operation: "delete"; sessionId: string }
  | { operation: "fork"; sessionId: string; options: ForkSessionOptions };
