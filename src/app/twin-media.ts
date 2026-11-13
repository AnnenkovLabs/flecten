import { TwinImageSchema } from "../../shared/twin";
import { type AttachmentReference, AttachmentReferencesSchema } from "../core/attachment-reference";
import type { SessionOptions } from "../core/session/options";
import type { SessionEvent } from "../core/types";

/** Reuse verified tool artifacts; never open a path suggested by a model. */
export class TwinMedia {
  #references: { sessionId: string; reference: AttachmentReference }[] = [];
  #omitted = 0;
  constructor(private readonly options: Pick<SessionOptions, "loadMedia">) {}

  reset(): void {
    this.#references = [];
    this.#omitted = 0;
  }

  note(event: SessionEvent): void {
    if (event.type !== "tool.finished" || !event.result.attachments?.length) return;
    for (const reference of AttachmentReferencesSchema.parse(event.result.attachments)) {
      if (!TwinImageSchema.shape.mediaType.safeParse(reference.mediaType).success) continue;
      if (reference.bytes > 2 * 1024 * 1024) {
        this.#omitted++;
        continue;
      }
      this.#references = [
        ...this.#references.filter((item) => item.reference.id !== reference.id).slice(-1),
        { sessionId: event.sessionId, reference },
      ];
    }
  }

  async load(signal: AbortSignal) {
    const images = [];
    for (const { sessionId, reference } of this.#references) {
      signal.throwIfAborted();
      if (!this.options.loadMedia) break;
      const parts = await this.options.loadMedia(sessionId, [reference]);
      signal.throwIfAborted();
      for (const part of parts)
        images.push(
          TwinImageSchema.parse({ mediaType: part.mediaType, data: part.data, name: part.name }),
        );
    }
    return {
      images: images.slice(-2),
      notice: this.#omitted
        ? `Visual evidence: ${this.#omitted} image artifacts exceeded the 2 MiB review limit; their pixels were not inspected.`
        : this.#references.length && !this.options.loadMedia
          ? "Visual evidence: image artifacts could not be loaded; their pixels were not inspected."
          : "",
    };
  }
}
