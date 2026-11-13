import type { FileKind } from "../types";
import type { ContextKind, ContextReference } from "./context-types";

export type SendMode = "queue" | "steer";

export type MentionKind = "file" | "folder" | "image" | ContextKind;

export interface MentionItem {
  path: string;
  kind: MentionKind;
  fileKind?: FileKind;
  preview?: string;
  label?: string;
  context?: ContextReference;
  resource?: { server: string; uri: string };
}

export type CommandSource = "builtin" | "skill";

export interface CommandItem {
  source: CommandSource;
  name: string;
  description: string;
  hint?: string;
}

export interface SkillCommand {
  name: string;
  description?: string;
}

export type QueueItemState = "pending" | "sending";

export interface QueuedMessage {
  id: string;
  text: string;
  mode: SendMode;
  state: QueueItemState;
  attachments?: string[];
  contexts?: ContextReference[];
}

export type AttachmentKind = "audio" | "image" | "pdf" | "text" | "folder" | "file";

export interface Attachment {
  id: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  path?: string;
  previewUrl?: string;
}
