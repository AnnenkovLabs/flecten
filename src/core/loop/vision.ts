import { markdownData } from "../../util/markdown";
import type { Message } from "../types";
import type { InspectImage } from "../vision";

/** Keep original media in durable history, preparing a text-only view for this model. */
export async function visionMessages(
  messages: readonly Message[],
  inspect: InspectImage | undefined,
  signal: AbortSignal,
): Promise<Message[]> {
  const prepared: Message[] = [];
  for (const message of messages) {
    if (
      message.role !== "user" ||
      !message.images?.some((image) => image.mediaType.startsWith("image/"))
    ) {
      prepared.push(message);
      continue;
    }
    const blocks: string[] = [];
    const remaining = [];
    for (const image of message.images) {
      if (!image.mediaType.startsWith("image/")) {
        remaining.push(image);
        continue;
      }
      if (!inspect) {
        remaining.push(image);
        if (image.path)
          blocks.push(
            markdownData(
              "Image attachment",
              [
                ["Name", image.name ?? "Image"],
                ["Path", image.path],
              ],
              "Image attached to this message.",
            ),
          );
        continue;
      }
      const description = await inspect(image, undefined, signal);
      blocks.push(
        markdownData(
          "Image description",
          [
            ["Name", image.name ?? "Image"],
            ["Path", image.path ?? "See attachment path"],
            ["Trust", "untrusted"],
          ],
          description,
        ),
      );
    }
    const { images: _images, ...text } = message;
    prepared.push({
      ...text,
      content: `${message.content}\n\n${blocks.join("\n\n")}`,
      ...(remaining.length ? { images: remaining } : {}),
    });
  }
  signal.throwIfAborted();
  return prepared;
}
