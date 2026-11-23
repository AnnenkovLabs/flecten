import {
  HistoryEditedSchema,
  HistorySelectedSchema,
  type MessageVersion,
} from "../../../shared/message-branches";
import type { Event } from "../../core/types";
import type { ReplayEvent } from "./replay";

export const ORIGINAL_BRANCH = "original";
export interface BranchMessage {
  messageId: string;
  variantId: string;
  branchId: string;
  sequence: number;
}
interface Branch<T> {
  events: T[];
  pending?: { messageId: string; variantId: string; parentBranchId: string };
}

export function isUserMessage(event: Event): boolean {
  return (
    (event.type === "session.started" &&
      !event.internal &&
      !event.resumed &&
      !event.continuation &&
      event.actor !== "twin" &&
      event.role !== "worker") ||
    (event.type === "steer.applied" && event.actor !== "twin")
  );
}

/** Branch controls choose an immutable prefix; every later event belongs to the selected branch. */
export function projectBranches<T extends ReplayEvent>(envelopes: readonly T[]) {
  const branches = new Map<string, Branch<T>>([[ORIGINAL_BRANCH, { events: [] }]]);
  const messages = new Map<number, BranchMessage>();
  const variants = new Map<string, BranchMessage[]>();
  const destinations = new Map<string, string>();
  const remember = (id: string) => {
    for (const entry of branches.get(id)?.events ?? []) {
      const message = messages.get(entry.seq);
      if (message) destinations.set(message.variantId, id);
    }
  };
  let branchId = ORIGINAL_BRANCH;
  for (const envelope of envelopes) {
    const event = envelope.event;
    if (event.type === "history.edited") {
      HistoryEditedSchema.parse(event);
      remember(branchId);
      const parent = branches.get(event.parentBranchId);
      const index = parent?.events.findIndex((entry) => entry.seq === event.targetSequence) ?? -1;
      if (!parent || index < 0 || branches.has(event.branchId))
        throw new Error("Invalid conversation branch boundary");
      const source = messages.get(event.targetSequence);
      if (source?.messageId !== event.messageId) throw new Error("Invalid edited message identity");
      // ponytail: prefixes share event objects; use parent links if many edits make arrays costly.
      branches.set(event.branchId, {
        events: parent.events.slice(0, index),
        pending: {
          messageId: event.messageId,
          variantId: event.branchId,
          parentBranchId: event.parentBranchId,
        },
      });
      branchId = event.branchId;
      continue;
    }
    if (event.type === "history.selected") {
      HistorySelectedSchema.parse(event);
      remember(branchId);
      if (!branches.has(event.branchId)) throw new Error("Unknown conversation branch");
      branchId = event.branchId;
      remember(branchId);
      continue;
    }
    const branch = branches.get(branchId);
    if (!branch) throw new Error("Conversation branch is missing");
    branch.events.push(envelope);
    if (!isUserMessage(event)) continue;
    const identity = branch.pending ?? {
      messageId: `m_${envelope.seq}`,
      variantId: `m_${envelope.seq}`,
    };
    delete branch.pending;
    const message = {
      messageId: identity.messageId,
      variantId: identity.variantId,
      branchId,
      sequence: envelope.seq,
    };
    messages.set(envelope.seq, message);
    const family = variants.get(message.messageId) ?? [];
    family.push(message);
    variants.set(message.messageId, family);
  }
  remember(branchId);
  const selected = branches.get(branchId)?.events ?? [];
  const visibleMessages = selected.flatMap(({ seq }) => {
    const message = messages.get(seq);
    return message ? [message] : [];
  });
  const messageVersions: MessageVersion[] = visibleMessages.map((message) => {
    const family = variants.get(message.messageId) ?? [message];
    return {
      messageId: message.messageId,
      current: family.findIndex((entry) => entry.variantId === message.variantId) + 1,
      variants: family.map((entry) => entry.variantId),
    };
  });
  return {
    envelopes: selected,
    branchId,
    messageVersions,
    visibleMessages,
    variants,
    destinations,
    pending: branches.get(branchId)?.pending,
  };
}
