import { type MessageVersion, MessageVersionSchema } from "../../../../shared/message-branches";
import type { ContextReference } from "../composer/context-types";
import {
  clearComposerDraft,
  composerDrafts,
  composerEditKey,
  writeComposerAttachments,
  writeComposerDraft,
} from "../composer/drafts.svelte";
import { requestAgent } from "../desktop";
import type { ComposerEdit } from "../message-types";
import { uniqueId } from "../run-helpers";
import type { ReasoningChoice, ThreadItem } from "../types";
import { focusComposer } from "../ui-polish";
import type { TaskView } from "./view.svelte";

interface HistoryHost {
  view: TaskView;
  sessionId(): string | null;
  connected(): boolean;
  modelReady(): Promise<void>;
  reasoning(): ReasoningChoice;
  reload(id: string): Promise<void>;
}

/** Versions belong to durable user messages; visible rows retain their presentation identity. */
export class MessageHistory {
  versions = $state<MessageVersion[]>([]);
  changing = $state(false);
  #edits = $state<Record<string, ComposerEdit>>({});

  constructor(private readonly host: HistoryHost) {}

  get editing(): ComposerEdit | null {
    return this.#edits[this.host.sessionId() ?? ""] ?? null;
  }

  begin(messageId: string, text: string): void {
    const id = this.host.sessionId();
    const message = this.versions.find((entry) => entry.messageId === messageId);
    if (!id || !message || this.blocked) return;
    if (this.editing?.messageId === messageId) {
      focusComposer();
      return;
    }
    this.cancel();
    const key = composerEditKey(uniqueId("edit"));
    writeComposerDraft(text, [], key);
    writeComposerAttachments(key, message.attachments ?? []);
    this.#edits[id] = { key, messageId };
    focusComposer();
  }

  cancel(): void {
    const id = this.host.sessionId();
    if (!id || this.changing) return;
    this.#clearEdit(id);
    focusComposer();
  }

  async save(
    text: string,
    attachments: string[],
    contexts: ContextReference[],
    retainedAttachments: string[],
  ): Promise<boolean> {
    const id = this.host.sessionId();
    const edit = this.editing;
    if (!id || !edit) return false;
    await this.host.modelReady();
    if (id !== this.host.sessionId() || edit.key !== this.editing?.key) return false;
    const reasoning = this.host.reasoning();
    const saved = await this.#change((id) =>
      requestAgent({
        type: "sessions.edit",
        id,
        messageId: edit.messageId,
        text,
        attachments,
        contexts,
        retainedAttachments,
        ...(reasoning === "auto" ? {} : { reasoning }),
      }),
    );
    if (saved && this.#edits[id]?.key === edit.key) this.#clearEdit(id);
    return saved;
  }

  #clearEdit(id: string): void {
    const edit = this.#edits[id];
    if (!edit) return;
    clearComposerDraft(edit.key);
    delete this.#edits[id];
    if (this.host.sessionId() === id) composerDrafts.insertion++;
  }

  get items(): ThreadItem[] {
    let index = 0;
    return this.host.view.thread.items.map((item) => {
      if (item.kind !== "message" || item.actor === "twin") return item;
      const version = this.versions[index++];
      return version
        ? {
            ...item,
            versions: {
              messageId: version.messageId,
              variantId: version.variants[version.current - 1] ?? "",
              variants: version.variants,
              index: version.current - 1,
              count: version.variants.length,
            },
          }
        : item;
    });
  }

  get blocked(): boolean {
    return (
      this.changing ||
      !this.host.connected() ||
      this.host.view.busy ||
      this.host.view.queued.length > 0 ||
      (this.host.view.state?.approvals.length ?? 0) > 0 ||
      this.host.view.subagents.items.some((agent) => agent.status === "running") ||
      this.host.view.jobs.some((job) => job.status === "running")
    );
  }

  set(input: unknown): void {
    this.versions = MessageVersionSchema.array().parse(input ?? []);
  }

  async refresh(): Promise<void> {
    const id = this.host.sessionId();
    if (!id || this.changing) return;
    try {
      const response = await requestAgent({ type: "sessions.get", id });
      if (id === this.host.sessionId() && !this.changing) this.set(response.messageVersions);
    } catch {
      // The next successful task attach restores controls from the durable journal.
    }
  }

  async select(messageId: string, variantId: string): Promise<boolean> {
    const id = this.host.sessionId();
    const selected = await this.#change((id) =>
      requestAgent({ type: "sessions.branch", id, messageId, variantId }),
    );
    if (selected && id) this.#clearEdit(id);
    return selected;
  }

  async #change(send: (id: string) => Promise<unknown>): Promise<boolean> {
    const id = this.host.sessionId();
    if (!id || this.blocked) return false;
    this.changing = true;
    try {
      await send(id);
      if (id === this.host.sessionId()) await this.host.reload(id);
      return true;
    } catch {
      return false;
    } finally {
      this.changing = false;
    }
  }
}
