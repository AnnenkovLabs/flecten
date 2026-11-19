function hash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

export class ReadTracker {
  readonly #hashes = new Map<string, string>();
  readonly #shownSymbols = new Map<string, string>();

  record(path: string, content: string): void {
    const nextHash = hash(content);
    const prevHash = this.#hashes.get(path);
    if (prevHash !== undefined && prevHash !== nextHash) {
      this.#clearSymbolsForPath(path);
    }
    this.#hashes.set(path, nextHash);
  }

  forget(path: string): void {
    this.#hashes.delete(path);
    this.#clearSymbolsForPath(path);
  }

  verify(path: string, content: string): "ok" | "unread" | "changed" {
    const stored = this.#hashes.get(path);
    if (!stored) return "unread";
    return stored === hash(content) ? "ok" : "changed";
  }

  /**
   * Checks whether an AST symbol block (`path`, `startLine..endLine`, `body`) was already
   * expanded in this session with identical contents; if not, records it.
   * Preserves 100% KV-cache append-only stability by only preventing duplicate expansion
   * in future tool outputs without mutating earlier messages.
   */
  markSymbolShown(path: string, startLine: number, endLine: number, body: string): boolean {
    const key = `${path}:${startLine}-${endLine}`;
    const bodyHash = hash(body);
    if (this.#shownSymbols.get(key) === bodyHash) return true;
    this.#shownSymbols.set(key, bodyHash);
    return false;
  }

  #clearSymbolsForPath(path: string): void {
    const prefix = `${path}:`;
    for (const key of this.#shownSymbols.keys()) {
      if (key.startsWith(prefix)) this.#shownSymbols.delete(key);
    }
  }
}
