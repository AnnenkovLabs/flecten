import { flacDuration, mp3Duration } from "./audio-duration";
import type { ImagePart } from "./types";

/** Local estimates reserve context before provider usage is available. Billing uses provider usage. */
export function mediaTokens(part: ImagePart): number {
  if (part.estimatedTokens !== undefined) return part.estimatedTokens;
  if (part.mediaType === "application/pdf") return Math.max(4096, Math.ceil(part.data.length / 4));
  if (part.mediaType.startsWith("audio/")) return Math.max(1024, Math.ceil(part.data.length / 512));
  return 1024;
}

function dimensions(bytes: Buffer, mediaType: string): [number, number] | undefined {
  if (mediaType === "image/png" && bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47)
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (mediaType === "image/gif" && bytes.length >= 10 && bytes.toString("ascii", 0, 3) === "GIF")
    return [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
  if (mediaType === "image/jpeg" && bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return undefined;
      const marker = bytes[offset + 1] ?? 0;
      if (marker === 0xda || marker === 0xd9) break;
      const size = bytes.readUInt16BE(offset + 2);
      if (size < 2 || offset + size + 2 > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        size >= 7
      )
        return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
      offset += size + 2;
    }
  }
  return undefined;
}

function wavDuration(bytes: Buffer): number | undefined {
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  )
    return undefined;
  let byteRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size > bytes.length) return undefined;
    if (type === "fmt " && size >= 16) byteRate = bytes.readUInt32LE(offset + 16);
    if (type === "data") dataBytes += size;
    offset += 8 + size + (size % 2);
  }
  return byteRate > 0 ? dataBytes / byteRate : undefined;
}

export function estimateMedia(bytes: Buffer, mediaType: string): number {
  if (mediaType === "application/pdf") {
    // ponytail: conservative byte reserve also covers compressed page streams. A provider
    // count-tokens endpoint can replace this estimate when its API exposes one.
    return Math.max(4096, Math.ceil(bytes.length / 3));
  }
  if (mediaType.startsWith("audio/")) {
    const seconds =
      mediaType === "audio/wav"
        ? wavDuration(bytes)
        : mediaType === "audio/mpeg"
          ? mp3Duration(bytes)
          : mediaType === "audio/flac"
            ? flacDuration(bytes)
            : undefined;
    // ponytail: other containers reserve a conservative 32 kbps duration. Extend the
    // container readers or use provider count-tokens when an exact estimate is needed.
    return seconds === undefined
      ? Math.max(1024, Math.ceil(bytes.length / 125))
      : Math.ceil(seconds * 32);
  }
  const size = dimensions(bytes, mediaType);
  if (!size || size[0] <= 0 || size[1] <= 0) return 2048;
  const scale = Math.min(1, 2048 / Math.max(...size));
  return 85 + 170 * Math.ceil((size[0] * scale) / 512) * Math.ceil((size[1] * scale) / 512);
}
