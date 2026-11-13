import type { ModuleReference } from "../../../shared/modules";
import type { ContextSummary } from "../../context";
import type { AttachmentReference } from "../attachment-reference";
import type { MemoryReference } from "../memory/command";
import type { ToolCall } from "./tool";

export interface ImagePart {
  mediaType: string;
  /** Local source or durable artifact, never sent as an image URL. */
  path?: string;
  data: string;
  name?: string;
  /** Local context reservation, replaced by actual provider usage for billing. */
  estimatedTokens?: number;
}

export interface UserMessage {
  role: "user";
  workingLanguage?: "en";
  sourceLanguage?: string;
  content: string;
  contextSummary?: ContextSummary;
  /** Exact human input, distinct from hooks, translations and memory context. */
  memorySource?: string;
  memoryReferences?: MemoryReference[];
  moduleReferences?: ModuleReference[];
  images?: ImagePart[];
  /** Replay resolves these artifact references before sending history to a provider. */
  attachmentRefs?: AttachmentReference[];
}

export interface AssistantMessage {
  role: "assistant";
  workingLanguage?: "en";
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  providerData?: unknown;
}

export interface ToolMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
  memoryReferences?: MemoryReference[];
  moduleReferences?: ModuleReference[];
}

export type Message = UserMessage | AssistantMessage | ToolMessage;

export interface Usage {
  input: number;
  output: number;
  cached: number;
  reasoning?: number;
  cacheWrite?: number;
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cached: 0 };
}

export function addUsage(left: Usage, right: Usage): Usage {
  const reasoning = (left.reasoning ?? 0) + (right.reasoning ?? 0);
  const cacheWrite = (left.cacheWrite ?? 0) + (right.cacheWrite ?? 0);
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cached: left.cached + right.cached,
    ...(reasoning > 0 ? { reasoning } : {}),
    ...(left.cacheWrite === undefined && right.cacheWrite === undefined ? {} : { cacheWrite }),
  };
}
