import type { AttachmentSnapshot } from "../attachment-reference";
import type { ContextReference } from "../context-reference";
import type { QueueItemMode } from "../queue/types";
import type { ReasoningEffort } from "./reasoning";

export type { ReasoningEffort } from "./reasoning";

export type Command =
  | {
      type: "run";
      prompt: string;
      reasoning?: ReasoningEffort;
      sessionId?: string;
      attachments?: string[];
      attachmentSnapshot?: AttachmentSnapshot;
      contexts?: ContextReference[];
      /** Id the client picked for this send; the same id twice starts one run. */
      clientId?: string;
      /** The run continues an interrupted one. */
      resumed?: boolean;
      /** The run continues the active work silently without adding a user message to the thread. */
      continuation?: boolean;
      internal?: boolean;
      actor?: "user" | "twin";
      /** A summary event may wake the model to converse, without any tools. */
      summaryWake?: true;
    }
  | { type: "stop"; mode?: "graceful" | "force"; target?: "worker" }
  | { type: "status" }
  | { type: "modules.invoke"; input: import("../modules/types").ModuleSurfaceInput }
  | {
      type: "queue.add";
      text: string;
      mode?: QueueItemMode;
      actor?: "user" | "twin";
      attachments?: string[];
      attachmentSnapshot?: AttachmentSnapshot;
      contexts?: ContextReference[];
      /** Id the client picked; adding the same id again returns the existing item. */
      id?: string;
    }
  | { type: "queue.edit"; id: string; text: string }
  | { type: "queue.remove"; id: string }
  | {
      type: "approval.respond";
      id: string;
      decision: "allow_once" | "allow_session" | "allow_always" | "deny";
      feedback?: string;
    }
  | { type: "approval.allowAll"; ids: string[] }
  | { type: "approval.denyAll"; ids: string[] }
  | { type: "checkpoint.list" }
  | { type: "checkpoint.diff"; id: string }
  | {
      type: "checkpoint.restore";
      id: string;
      target?: "before" | "after";
      /** Overwrite files edited after the checkpoint. */
      force?: boolean;
      /** Also restore flecten.config.json, .flecten/ and .env files; off unless the user asks. */
      includeProtected?: boolean;
      paths?: string[];
    }
  | { type: "tool.cancel"; callId: string }
  | { type: "subagent.stop"; id: string }
  | { type: "jobs.list" }
  | { type: "jobs.stop"; id: string }
  | { type: "context.compact"; focus?: string };

/** A command addressed to one session; without `sessionId` it goes to the focused session. */
export type RoutedCommand = Command & { sessionId?: string };
