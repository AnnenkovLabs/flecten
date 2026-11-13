import type { SessionState } from "../../../shared/session-state";
import type { HarnessService } from "../service";
import type { Message, SessionId } from "../types";
import type { SessionOptions } from "./options";

/** Cheap counters for the task list: is it running and what waits in it. */
export interface SessionPeek {
  running: boolean;
  turns: number;
  queue: number;
  approvals: number;
  jobs: number;
  state?: SessionState | undefined;
}

export interface SessionHandle extends HarnessService {
  update(next: Partial<SessionOptions>): void;
  isBusy(): boolean;
  peek(): SessionPeek;
  /** A tool call of this session waits for this approval. */
  waitsFor(approvalId: string): boolean;
  getSessionId(): SessionId | undefined;
  getHistory(): readonly Message[];
  flush(): Promise<void>;
  dispose(): Promise<void>;
}
