export const PROTECTED_OUTPUT_LIMIT = 2 * 1024 * 1024;
export const PROTECTED_OUTPUT_TRUNCATED =
  "[Provider protection: output exceeded the 2 MiB inspection limit and was suppressed.]\n";

/** Buffers local trusted output until complete credential records can be inspected. */
export class ProtectedOutputBuffer {
  readonly #channels = new Map<string, string[]>();
  #bytes = 0;
  #overflow = false;
  #finished = false;

  constructor(private readonly protect: (text: string) => string) {}

  push(text: string, channel = "stdout"): void {
    if (this.#finished) throw new Error("Protected output buffer has been finished");
    if (this.#overflow || !text) return;
    const bytes = Buffer.byteLength(text);
    if (bytes > PROTECTED_OUTPUT_LIMIT - this.#bytes) {
      this.#overflow = true;
      // ponytail: overflowing output is suppressed in full, because even a completed line
      // may be part of an unfinished multiline secret. An incremental scanner can retain it.
      this.#channels.clear();
      return;
    }
    this.#bytes += bytes;
    const chunks = this.#channels.get(channel);
    if (chunks) chunks.push(text);
    else this.#channels.set(channel, [text]);
  }

  finish(): string {
    if (this.#finished) return "";
    this.#finished = true;
    if (this.#overflow) return PROTECTED_OUTPUT_TRUNCATED;
    const channels = [...this.#channels.values()].map((chunks) => Bun.stripANSI(chunks.join("")));
    this.#channels.clear();
    // Learn credentials from every pipe before exposing any pipe, so copies in another
    // pipe are also protected. Pipes keep their own lexical units across interleaved writes.
    for (const channel of channels) this.protect(channel);
    return channels.map((channel) => this.protect(channel)).join("");
  }
}
