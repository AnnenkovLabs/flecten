import { z } from "zod";
import type { MessageVersion } from "../../shared/message-branches";
import { ContextReferencesSchema } from "../core/context-reference";
import type { SessionOptions } from "../core/session/options";
import type { Event, ReasoningEffort } from "../core/types";
import { projectBranches } from "../store/events/branches";
import type { EventEnvelope } from "../store/events/envelope";
import { editedMessageAttachments, historyAttachmentMetadata } from "./message-attachments";
import type { SessionPool } from "./session-pool";
import type { SessionStorage } from "./session-storage";

export const MessageEditOptionsSchema = z.object({
  attachments: z.array(z.string().min(1).max(4096)).max(100).optional(),
  contexts: ContextReferencesSchema.optional(),
  retainedAttachments: z.array(z.string().min(1).max(256)).max(130).optional(),
});
export type MessageEditOptions = z.infer<typeof MessageEditOptionsSchema>;

export interface MessageHistory {
  events: Event[];
  messageVersions: MessageVersion[];
}

function view(envelopes: EventEnvelope[]): MessageHistory {
  const selected = projectBranches(envelopes);
  return {
    events: selected.envelopes.map(({ event, ts, schemaVersion }) => ({
      ...event,
      ...(schemaVersion > 0 ? { timestamp: Date.parse(ts) } : {}),
    })),
    messageVersions: selected.messageVersions.map((version, index) => {
      const message = selected.visibleMessages[index];
      const event = selected.envelopes.find(({ seq }) => seq === message?.sequence)?.event;
      return message &&
        event &&
        (event.type === "session.started" || event.type === "steer.applied")
        ? { ...version, attachments: historyAttachmentMetadata(event, message.sequence) }
        : version;
    }),
  };
}

/** Edits and selections append controls; existing messages and descendants remain untouched. */
export function messageBranches(
  pool: SessionPool,
  storage: SessionStorage,
  currentOptions: (sessionId?: string) => SessionOptions,
) {
  const readMessageHistory = async (id: string) => {
    await pool.flush(id);
    return view(await storage.envelopes(id));
  };
  return {
    readMessageHistory,
    async editMessage(
      id: string,
      messageId: string,
      text: string,
      reasoning?: ReasoningEffort,
      input: MessageEditOptions = {},
    ) {
      const replacement = MessageEditOptionsSchema.parse(input);
      return pool.withIdleHistory(id, async (start) => {
        const raw = await storage.envelopes(id);
        const selected = projectBranches(raw);
        const message = selected.visibleMessages.find((entry) => entry.messageId === messageId);
        if (!message) throw new Error("Message is no longer on the selected conversation branch");
        const target = selected.envelopes.find(({ seq }) => seq === message.sequence)?.event;
        if (!target || (target.type !== "session.started" && target.type !== "steer.applied"))
          throw new Error("Only a user message can be edited");
        const { snapshot, contexts } = await editedMessageAttachments(
          target,
          message.sequence,
          replacement,
          id,
          currentOptions(id),
        );
        const branchId = `v_${crypto.randomUUID()}`;
        await storage.persist({
          type: "history.edited",
          sessionId: id,
          branchId,
          parentBranchId: selected.branchId,
          messageId,
          targetSequence: message.sequence,
        });
        let unsubscribe = () => {};
        let hasStarted = false;
        const started = new Promise<void>((resolve, reject) => {
          unsubscribe = pool.subscribe((event) => {
            if (event.sessionId !== id) return;
            if (event.type === "session.started") {
              hasStarted = true;
              resolve();
            } else if (event.type === "error") reject(new Error(event.message));
          });
          void start({
            type: "run",
            sessionId: id,
            prompt: text,
            attachmentSnapshot: snapshot,
            ...(contexts ? { contexts } : {}),
            ...(reasoning ? { reasoning } : {}),
          }).catch(reject);
        });
        try {
          await started;
          await pool.flush(id);
          return await readMessageHistory(id);
        } catch (error) {
          if (hasStarted) throw error;
          await storage.persist({
            type: "history.selected",
            sessionId: id,
            branchId: selected.branchId,
          });
          await pool.close(id);
          throw error;
        } finally {
          unsubscribe();
        }
      });
    },
    async selectMessageBranch(id: string, messageId: string, variantId: string) {
      return pool.withIdleHistory(id, async () => {
        const selected = projectBranches(await storage.envelopes(id));
        if (!selected.visibleMessages.some((entry) => entry.messageId === messageId))
          throw new Error("Message is no longer on the selected conversation branch");
        const variant = selected.variants
          .get(messageId)
          ?.find((entry) => entry.variantId === variantId);
        if (!variant) throw new Error("Unknown message variant");
        await storage.persist({
          type: "history.selected",
          sessionId: id,
          branchId: selected.destinations.get(variantId) ?? variant.branchId,
        });
        return readMessageHistory(id);
      });
    },
  };
}
