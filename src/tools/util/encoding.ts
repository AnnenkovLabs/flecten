import { open } from "node:fs/promises";

/** Bytes looked at to tell text from binary and to find a BOM. */
export const SAMPLE_BYTES = 8192;

export type Encoding = "utf-8" | "utf-16le" | "utf-16be";

export interface Detected {
  encoding: Encoding;
  bomBytes: number;
  binary: boolean;
}

function startsWith(buffer: Uint8Array, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

/** BOM decides UTF-16; otherwise UTF-8, and a NUL byte in the sample means binary. */
export function detectEncoding(sample: Uint8Array): Detected {
  if (startsWith(sample, [0xff, 0xfe])) {
    return { encoding: "utf-16le", bomBytes: 2, binary: false };
  }
  if (startsWith(sample, [0xfe, 0xff])) {
    return { encoding: "utf-16be", bomBytes: 2, binary: false };
  }
  const bomBytes = startsWith(sample, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  return { encoding: "utf-8", bomBytes, binary: sample.includes(0) };
}

/** The first `limit` bytes of a file (SAMPLE_BYTES by default). */
export async function sampleFile(
  path: string,
  size: number,
  limit = SAMPLE_BYTES,
): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const length = Math.min(limit, size);
    const buffer = new Uint8Array(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function decodeFileBytes(bytes: Uint8Array): {
  text: string;
  encoding: Encoding;
  bomBytes: number;
} {
  const detected = detectEncoding(bytes.subarray(0, SAMPLE_BYTES));
  const decoder = new TextDecoder(detected.encoding);
  const body = decoder.decode(bytes.subarray(detected.bomBytes));
  return {
    text: detected.bomBytes === 3 ? `\uFEFF${body}` : body,
    encoding: detected.encoding,
    bomBytes: detected.bomBytes,
  };
}

export function encodeFileText(
  text: string,
  encoding: Encoding,
  bomBytes: number,
): string | Uint8Array {
  if (encoding === "utf-8") return text;
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const le = Buffer.from(body, "utf16le");
  if (encoding === "utf-16le") {
    if (bomBytes === 2) {
      const out = new Uint8Array(2 + le.length);
      out[0] = 0xff;
      out[1] = 0xfe;
      out.set(le, 2);
      return out;
    }
    return new Uint8Array(le);
  }
  const be = new Uint8Array((bomBytes === 2 ? 2 : 0) + le.length);
  let offset = 0;
  if (bomBytes === 2) {
    be[0] = 0xfe;
    be[1] = 0xff;
    offset = 2;
  }
  for (let index = 0; index + 1 < le.length; index += 2) {
    be[offset + index] = le[index + 1] ?? 0;
    be[offset + index + 1] = le[index] ?? 0;
  }
  return be;
}
