import type { ImagePart } from "../core/types";

export function chatMedia(part: ImagePart): Record<string, unknown> {
  if (part.mediaType.startsWith("audio/")) {
    const format =
      part.mediaType === "audio/wav" ? "wav" : part.mediaType === "audio/mpeg" ? "mp3" : undefined;
    if (!format)
      throw new Error(
        `Chat audio input accepts WAV or MP3. Convert ${part.name ?? part.mediaType} before attaching it.`,
      );
    return { type: "input_audio", input_audio: { data: part.data, format } };
  }
  return part.mediaType === "application/pdf"
    ? {
        type: "file",
        file: {
          filename: part.name ?? "attachment.pdf",
          file_data: `data:${part.mediaType};base64,${part.data}`,
        },
      }
    : { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.data}` } };
}

export function responsesMedia(part: ImagePart): Record<string, unknown> {
  if (part.mediaType.startsWith("audio/"))
    throw new Error(
      "This Responses connection does not accept audio input. Select a Chat Completions or Gemini audio model.",
    );
  return part.mediaType === "application/pdf"
    ? {
        type: "input_file",
        filename: part.name ?? "attachment.pdf",
        file_data: `data:${part.mediaType};base64,${part.data}`,
      }
    : { type: "input_image", image_url: `data:${part.mediaType};base64,${part.data}` };
}

export function anthropicMedia(part: ImagePart): Record<string, unknown> {
  if (part.mediaType.startsWith("audio/"))
    throw new Error(
      "Anthropic does not accept audio input. Select an audio model before attaching audio.",
    );
  return {
    type: part.mediaType === "application/pdf" ? "document" : "image",
    source: { type: "base64", media_type: part.mediaType, data: part.data },
  };
}
