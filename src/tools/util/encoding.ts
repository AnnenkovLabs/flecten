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
