import { isSensitiveKey, redactKnown } from "./redact";

const BUFFER_LIMIT = 8192;
const MASK = "[redacted]";

function keyName(value: string): string {
  let out = "";
  for (const char of value) {
    if (
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      (char >= "0" && char <= "9") ||
      "_.-".includes(char)
    )
      out += char;
  }
  return out;
}

function assignment(
  token: string,
): { separator: number; quote: string | undefined; closed: boolean } | undefined {
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] !== ":" && token[index] !== "=") continue;
    if (!isSensitiveKey(keyName(token.slice(0, index)))) continue;
    const value = token.slice(index + 1);
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : undefined;
    return { separator: index, quote, closed: quote !== undefined && value.indexOf(quote, 1) >= 0 };
  }
  return undefined;
}

/**
 * Holds incomplete lexical units, so credentials never cross a published chunk boundary.
 * Assignments and PEM blocks have explicit states; arbitrarily long ordinary tokens drain
 * in bounded pieces. The only delayed ordinary text is the currently incomplete word.
 */
export class RedactionStream {
  #pending = "";
  #value: "none" | "delimiter" | "assignment" | "bearer" = "none";
  #quote: string | undefined;
  #pem = false;
  #pemEnd = false;
  #pemHeader = "";
  #suppressedToken = false;
  readonly #overlap: number;
  #knownPending = "";
  readonly #known: readonly string[];

  constructor(private readonly secrets: readonly string[] = []) {
    this.#overlap = Math.max(256, ...secrets.map((secret) => secret.length));
    this.#known = [...new Set(secrets.filter((secret) => secret.length >= 4))].sort(
      (left, right) => right.length - left.length,
    );
  }

  push(text: string): string {
    return this.#scan(this.#knownText(text));
  }

  #knownText(text: string): string {
    if (this.#known.length === 0) return text;
    let output = "";
    for (const char of text) {
      this.#knownPending += char;
      output += this.#drainKnown(false);
    }
    return output;
  }

  #drainKnown(complete: boolean): string {
    let output = "";
    while (this.#knownPending) {
      const prefixes = this.#known.filter((secret) => secret.startsWith(this.#knownPending));
      if (!complete && prefixes.some((secret) => secret.length > this.#knownPending.length)) break;
      const matched = this.#known.find((secret) => this.#knownPending.startsWith(secret));
      if (matched) {
        output += MASK;
        this.#knownPending = this.#knownPending.slice(matched.length);
      } else {
        if (!complete && prefixes.length > 0) break;
        output += this.#knownPending[0];
        this.#knownPending = this.#knownPending.slice(1);
      }
    }
    return output;
  }

  #scan(text: string): string {
    let output = "";
    for (const char of text) {
      if (char.trim().length === 0) {
        output += this.#word();
        if (this.#pemHeader) {
          this.#pemHeader += char;
          if (this.#pemHeader.length >= 256) {
            this.#pemHeader = "";
            this.#pem = true;
            output += "[redacted:pem]";
          }
        } else if (!this.#pem) output += char;
        if (char === "\n" || char === "\r") {
          if (!this.#pem) {
            this.#value = "none";
            this.#quote = undefined;
          }
        }
        continue;
      }
      this.#pending += char;
      if (this.#pending.length < BUFFER_LIMIT + this.#overlap) continue;
      const prefix = this.#pending.slice(0, -this.#overlap);
      if (this.#pemHeader) {
        this.#pemHeader = "";
        this.#pem = true;
        output += "[redacted:pem]";
      }
      if (
        this.#pem ||
        this.#value === "assignment" ||
        this.#value === "bearer" ||
        this.#suppressedToken
      ) {
        if (!this.#pem && !this.#suppressedToken) output += MASK;
        this.#suppressedToken = true;
        this.#pending = this.#pending.slice(-this.#overlap);
        continue;
      }
      const safe = redactKnown(this.#pending, this.secrets);
      const assigned = assignment(this.#pending);
      if (safe !== this.#pending || assigned) {
        if (assigned && !assigned.closed) {
          this.#value = "assignment";
          this.#quote = assigned.quote;
        }
        output += MASK;
        this.#suppressedToken = true;
      } else output += prefix;
      this.#pending = this.#pending.slice(-this.#overlap);
    }
    return output;
  }

  finish(): string {
    const knownTail = this.#scan(this.#drainKnown(true));
    const tail = knownTail + this.#word() + (this.#pemHeader ? "[redacted:pem]" : "");
    this.#value = "none";
    this.#quote = undefined;
    this.#pem = false;
    this.#pemHeader = "";
    return tail;
  }

  #word(): string {
    const token = this.#pending;
    this.#pending = "";
    if (!token) return "";
    if (this.#pem) {
      this.#suppressedToken = false;
      if (token === "-----END") this.#pemEnd = true;
      if (this.#pemEnd && token.endsWith("KEY-----")) {
        this.#pem = false;
        this.#pemEnd = false;
      }
      return "";
    }
    if (this.#pemHeader) {
      this.#pemHeader += token;
      if (!token.endsWith("-----") && this.#pemHeader.length < 256) return "";
      const header = this.#pemHeader;
      this.#pemHeader = "";
      if (header.endsWith("PRIVATE KEY-----") || header.length >= 256) {
        this.#pem = true;
        return "[redacted:pem]";
      }
      return redactKnown(header, this.secrets);
    }
    if (token === "-----BEGIN") {
      this.#pemHeader = token;
      return "";
    }
    if (this.#suppressedToken) {
      this.#suppressedToken = false;
      if (this.#value === "bearer" || (this.#quote && token.includes(this.#quote))) {
        this.#value = "none";
        this.#quote = undefined;
      }
      return "";
    }
    if (this.#value === "assignment") {
      if (this.#quote && token.includes(this.#quote)) {
        this.#value = "none";
        this.#quote = undefined;
      } else if (!this.#quote && (token[0] === '"' || token[0] === "'")) {
        this.#quote = token[0];
        if (token.indexOf(this.#quote, 1) >= 0) {
          this.#quote = undefined;
          this.#value = "none";
        }
      }
      return MASK;
    }
    if (this.#value === "bearer") {
      this.#value = "none";
      return MASK;
    }
    if (this.#value === "delimiter") {
      this.#value = "none";
      if (token.startsWith(":") || token.startsWith("=")) {
        this.#value = "assignment";
        return token[0] + (token.length > 1 ? MASK : "");
      }
    }
    const assigned = assignment(token);
    if (assigned && !assigned.closed) {
      this.#value = "assignment";
      this.#quote = assigned.quote;
    } else if (isSensitiveKey(keyName(token))) this.#value = "delimiter";
    if (keyName(token).toLowerCase() === "bearer") this.#value = "bearer";
    if (assigned && token.length > assigned.separator + 1)
      return token.slice(0, assigned.separator + 1) + MASK;
    return redactKnown(token, this.secrets);
  }
}
