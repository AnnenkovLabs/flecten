function hash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

export class ReadTracker {
  readonly #hashes = new Map<string, string>();

  record(path: string, content: string): void {
    this.#hashes.set(path, hash(content));
  }

  forget(path: string): void {
    this.#hashes.delete(path);
  }

  verify(path: string, content: string): "ok" | "unread" | "changed" {
    const stored = this.#hashes.get(path);
    if (!stored) return "unread";
    return stored === hash(content) ? "ok" : "changed";
  }
}
