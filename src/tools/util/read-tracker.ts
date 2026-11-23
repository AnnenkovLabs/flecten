function hash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

function trackerKey(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? path.replaceAll("\\", "/").toLowerCase() : path;
}

export class ReadTracker {
  readonly #hashes = new Map<string, string>();
  readonly #shownSymbols = new Map<string, string>();
  readonly #platform: NodeJS.Platform;

  constructor(platform: NodeJS.Platform = process.platform) {
    this.#platform = platform;
  }

  record(path: string, content: string): void {
    const key = trackerKey(path, this.#platform);
    const nextHash = hash(content);
    const prevHash = this.#hashes.get(key);
    if (prevHash !== undefined && prevHash !== nextHash) {
      this.#clearSymbolsForPath(key);
    }
    this.#hashes.set(key, nextHash);
  }

  forget(path: string): void {
    const key = trackerKey(path, this.#platform);
    this.#hashes.delete(key);
    this.#clearSymbolsForPath(key);
  }

  clear(): void {
    this.#hashes.clear();
    this.#shownSymbols.clear();
  }

  verify(path: string, content: string): "ok" | "unread" | "changed" {
    const stored = this.#hashes.get(trackerKey(path, this.#platform));
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
    const key = `${trackerKey(path, this.#platform)}:${startLine}-${endLine}`;
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
