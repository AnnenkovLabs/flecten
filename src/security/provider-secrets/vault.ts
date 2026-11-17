import { createHmac, randomBytes } from "node:crypto";
import { isSensitiveKey, registerRedactionSecret } from "../../util/redact";
import { scanSecrets } from "./scanner";

const TAG_START = "[[secret_";
const MAX_DEPTH = 128;
const registrations = new FinalizationRegistry<Map<string, () => void>>((entries) => {
  for (const unregister of entries.values()) unregister();
  entries.clear();
});

function variants(secret: string): string[] {
  const json = JSON.stringify(secret).slice(1, -1);
  const bytes = Buffer.from(secret);
  return [
    ...new Set([
      secret,
      json,
      encodeURIComponent(secret),
      bytes.toString("base64"),
      bytes.toString("base64url"),
      bytes.toString("hex"),
    ]),
  ];
}

function objectEntries(value: object): Array<[string, unknown]> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Provider protection accepts only plain model data");
  }
  return Object.entries(value);
}

/** Opaque per-provider-runtime references. Only this process knows the HMAC key and original values. */
export class SecretVault {
  readonly #key = randomBytes(32);
  readonly #tags = new Map<string, string>();
  readonly #values = new Map<string, string>();
  readonly #unregister = new Map<string, () => void>();
  #disposed = false;

  constructor() {
    // Unreachable provider runtimes must not keep raw values alive in the shared log registry.
    registrations.register(this, this.#unregister, this.#key);
  }

  register(value: string): string {
    this.#assertLive();
    if (!value || value.includes(TAG_START))
      throw new Error("Cannot register an empty or tagged secret");
    const existing = this.#values.get(value);
    if (existing) return existing;
    const digest = createHmac("sha256", this.#key).update(value).digest("hex");
    const tag = `${TAG_START}${digest}]]`;
    for (const variant of variants(value)) {
      if (!this.#values.has(variant)) {
        const variantTag = `${TAG_START}${createHmac("sha256", this.#key).update(variant).digest("hex")}]]`;
        this.#tags.set(variantTag, variant);
        this.#values.set(variant, variantTag);
      }
      if (!this.#unregister.has(variant))
        this.#unregister.set(variant, registerRedactionSecret(variant));
    }
    return tag;
  }

  protect<T>(value: T): T {
    this.#assertLive();
    this.#collect(value, 0, new Set());
    const replacements = [...this.#values].sort(([left], [right]) => right.length - left.length);
    return this.#walk(value, (text) => this.#replace(text, replacements), 0, new Set()) as T;
  }

  restore<T>(value: T, transformSecret?: (secret: string, tag: string) => string): T {
    this.#assertLive();
    return this.#walk(value, (text) => this.#reveal(text, transformSecret), 0, new Set()) as T;
  }

  contains(value: unknown): boolean {
    this.#assertLive();
    let found = false;
    this.#walk(
      value,
      (text) => {
        if (text.includes(TAG_START)) found = true;
        return text;
      },
      0,
      new Set(),
    );
    return found;
  }

  seed(values: readonly string[]): void {
    for (const value of values) if (value) this.register(value);
  }

  get values(): readonly string[] {
    return [...this.#values.keys()];
  }

  dispose(): void {
    registrations.unregister(this.#key);
    for (const unregister of this.#unregister.values()) unregister();
    this.#unregister.clear();
    this.#tags.clear();
    this.#values.clear();
    this.#key.fill(0);
    this.#disposed = true;
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("Provider secret vault has been disposed");
  }

  #collect(value: unknown, depth: number, ancestors: Set<object>): void {
    if (depth > MAX_DEPTH) throw new Error("Provider protection data exceeds maximum nesting");
    if (typeof value === "string") {
      for (const secret of scanSecrets(value)) this.register(secret);
    } else if (typeof value === "object" && value !== null) {
      if (ancestors.has(value)) throw new Error("Provider protection data must not contain cycles");
      ancestors.add(value);
      if (Array.isArray(value)) {
        for (const entry of value) this.#collect(entry, depth + 1, ancestors);
      } else {
        for (const [key, entry] of objectEntries(value)) {
          this.#collect(key, depth + 1, ancestors);
          if (
            isSensitiveKey(key) &&
            typeof entry === "string" &&
            entry.length >= 4 &&
            !entry.includes(TAG_START)
          ) {
            const separator = entry.indexOf(" ");
            const scheme = separator > 0 ? entry.slice(0, separator).toLowerCase() : "";
            const secret = new Set(["bearer", "basic", "token"]).has(scheme)
              ? entry.slice(separator + 1).trim()
              : entry;
            if (secret) this.register(secret);
          }
          this.#collect(entry, depth + 1, ancestors);
        }
      }
      ancestors.delete(value);
    }
  }

  #walk(
    value: unknown,
    transform: (text: string) => string,
    depth: number,
    ancestors: Set<object>,
  ): unknown {
    if (depth > MAX_DEPTH) throw new Error("Provider protection data exceeds maximum nesting");
    if (typeof value === "string") return transform(value);
    if (typeof value !== "object" || value === null) return value;
    if (ancestors.has(value)) throw new Error("Provider protection data must not contain cycles");
    ancestors.add(value);
    let result: unknown;
    if (Array.isArray(value)) {
      result = value.map((entry) => this.#walk(entry, transform, depth + 1, ancestors));
    } else {
      const entries = objectEntries(value).map(
        ([key, entry]) =>
          [transform(key), this.#walk(entry, transform, depth + 1, ancestors)] as const,
      );
      const keys = new Set(entries.map(([key]) => key));
      if (keys.size !== entries.length)
        throw new Error("Provider protection would overwrite an object key");
      result = Object.fromEntries(entries);
    }
    ancestors.delete(value);
    return result;
  }

  #replace(text: string, replacements: ReadonlyArray<readonly [string, string]>): string {
    let output = "";
    let cursor = 0;
    while (cursor < text.length) {
      let tagStart = text.indexOf(TAG_START, cursor);
      while (tagStart >= 0) {
        const close = text.indexOf("]]", tagStart + TAG_START.length);
        if (close >= 0 && this.#tags.has(text.slice(tagStart, close + 2))) break;
        tagStart = text.indexOf(TAG_START, tagStart + TAG_START.length);
      }
      let next = text.length;
      let matched: readonly [string, string] | undefined;
      for (const replacement of replacements) {
        const at = text.indexOf(replacement[0], cursor);
        if (at >= 0 && at < next) {
          next = at;
          matched = replacement;
        }
      }
      if (tagStart >= 0 && tagStart <= next) {
        const close = text.indexOf("]]", tagStart + TAG_START.length);
        if (close < 0) return output + text.slice(cursor);
        output += text.slice(cursor, close + 2);
        cursor = close + 2;
      } else if (matched) {
        output += text.slice(cursor, next) + matched[1];
        cursor = next + matched[0].length;
      } else return output + text.slice(cursor);
    }
    return output;
  }

  #reveal(text: string, transformSecret?: (secret: string, tag: string) => string): string {
    let output = "";
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(TAG_START, cursor);
      if (start < 0) return output + text.slice(cursor);
      const end = text.indexOf("]]", start + TAG_START.length);
      if (end < 0) throw new Error("Unknown or incomplete provider secret tag");
      const tag = text.slice(start, end + 2);
      const secret = this.#tags.get(tag);
      if (secret === undefined) throw new Error("Unknown provider secret tag");
      output +=
        text.slice(cursor, start) + (transformSecret ? transformSecret(secret, tag) : secret);
      cursor = end + 2;
    }
    return output;
  }
}
