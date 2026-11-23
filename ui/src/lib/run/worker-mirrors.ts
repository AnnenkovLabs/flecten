import { t } from "../i18n.svelte";
import { toolReferences } from "../markdown/tool-references";
import type { PendingToolCall, RunAction, ThreadItem } from "../types";

export interface WorkerReasoning {
  id: string;
  turn: number;
  text: string;
  streaming: boolean;
  startedAt?: number;
  reasoningMs?: number;
}

export function workerMirrors(items: readonly ThreadItem[]): ReadonlyMap<string, RunAction> {
  return new Map(
    items.flatMap((item) =>
      item.kind === "worker" ? item.actions.map((action) => [action.id, action] as const) : [],
    ),
  );
}

export function workerThoughtMirrors(
  items: readonly ThreadItem[],
): ReadonlyMap<string, WorkerReasoning> {
  return new Map(
    items.flatMap((item) =>
      item.kind === "worker"
        ? (item.thoughts ?? []).map((thought) => [thought.id, thought] as const)
        : [],
    ),
  );
}

export function isTalkerThinking(items: readonly ThreadItem[]): boolean {
  return items.some(
    (item) =>
      item.kind === "run" &&
      item.summary.live === true &&
      item.summary.turns.some((turn) => turn.reasoningStreaming === true),
  );
}

/** Last non-empty line of streamed reasoning, used as a compact single-line live preview. */
export function reasoningPreviewLine(text: string): string {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length > 0) return line;
  }
  return "";
}

export interface ConversationLiveSnapshot {
  live: boolean;
  liveLabel: string;
  retryUntil: number | undefined;
  pendingCalls: PendingToolCall[];
}

export function conversationLiveState(view: {
  live: boolean;
  stopping: boolean;
  liveLabel: string;
  thread: { pendingCalls: PendingToolCall[] };
  worker: {
    running: boolean;
    liveLabel: string;
    retryUntil: number;
    transcript: { pendingCalls: PendingToolCall[] };
  };
}): ConversationLiveSnapshot {
  if (view.live) {
    return {
      live: true,
      liveLabel: view.liveLabel,
      retryUntil: undefined,
      pendingCalls: view.thread.pendingCalls,
    };
  }
  if (view.worker.running) {
    return {
      live: true,
      liveLabel: view.stopping ? t("Waiting for the step to finish") : view.worker.liveLabel,
      retryUntil: view.worker.retryUntil || undefined,
      pendingCalls: view.worker.transcript.pendingCalls,
    };
  }
  return {
    live: false,
    liveLabel: view.liveLabel,
    retryUntil: undefined,
    pendingCalls: view.thread.pendingCalls,
  };
}

/**
 * Each Worker call and thought mirrors into Conversation chronologically; explicit prose
 * tool references replace automatic tool mirrors, and live Worker thinking yields while
 * Talker itself is actively thinking.
 */
export function conversationItems(
  items: readonly ThreadItem[],
  tools: ReadonlyMap<string, RunAction>,
  thoughts?: ReadonlyMap<string, WorkerReasoning>,
  talkerThinking = false,
): ThreadItem[] {
  const known = new Set(tools.keys());
  const referenced = new Set(
    items.flatMap((item) =>
      item.kind === "answer"
        ? toolReferences(item.text, known).flatMap((part) =>
            part.kind === "tool" ? [part.id] : [],
          )
        : [],
    ),
  );
  return items.filter((item) => {
    if (item.kind === "worker") return false;
    if (item.kind === "worker-tool") return !referenced.has(item.reference);
    if (item.kind === "worker-reasoning") {
      const thought = thoughts?.get(item.reference);
      if (!thought || thought.text.length === 0) return false;
      if (talkerThinking && thought.streaming) return false;
    }
    return true;
  });
}
