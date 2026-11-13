import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { MAX_ATTACHMENT_BYTES } from "./attachment-reference";
import { estimateMedia } from "./media";
import type { ImagePart } from "./types";

/** Magic bytes, including saved .bin artifacts, determine the image format. */
export function imageMediaType(bytes: Uint8Array): string | undefined {
  const ascii = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  if (bytes[0] === 137 && ascii(1, 4) === "PNG" && bytes[4] === 13 && bytes[5] === 10)
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "image/avif";
  return undefined;
}

export async function readImage(path: string): Promise<ImagePart> {
  const info = await stat(path);
  if (!info.isFile() || info.size === 0 || info.size > MAX_ATTACHMENT_BYTES)
    throw new Error("Images must be regular files between 1 byte and 10 MiB.");
  const bytes = Buffer.from(
    await Bun.file(path)
      .slice(0, MAX_ATTACHMENT_BYTES + 1)
      .arrayBuffer(),
  );
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("Image grew beyond the 10 MiB limit.");
  const mediaType = imageMediaType(bytes);
  if (!mediaType) throw new Error("Unsupported image. Use PNG, JPEG, WebP, GIF or AVIF.");
  return {
    mediaType,
    data: Buffer.from(bytes).toString("base64"),
    name: basename(path),
    path,
    estimatedTokens: estimateMedia(bytes, mediaType),
  };
}
