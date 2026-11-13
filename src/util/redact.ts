const MASK = "[redacted]";
const MASKED = /^\[redacted(?::[^\]]*)?\]$/;
const MAX_DEPTH = 32;
const JSON_PARSE_LIMIT = 1_000_000;

const KEY_NAME =
  "[A-Za-z0-9_.-]{0,64}(?:authorization|api[_-]?key|token|secret|password|passwd|cookie)[A-Za-z0-9_.-]{0,64}";
const KEY = `(?<![A-Za-z0-9_.-])${KEY_NAME}(?![A-Za-z0-9_.-])`;
const KEY_END =
  "(?<![A-Za-z0-9_.-])(?:[A-Za-z0-9_.-]{0,64}(?:authorization|api[_-]?key|token|secret|password|passwd|cookie)|[A-Za-z0-9_.-]{0,64}secret[A-Za-z0-9_.-]{0,64}key)(?![A-Za-z0-9_.-])";

const PEM =
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const GITHUB = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const GOOGLE = /\bAIza[0-9A-Za-z_-]{35}\b/g;
const AWS = /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g;
const OPENAI = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\b(Bearer\s+)([A-Za-z0-9\-._~+/]{8,}={0,2})/gi;
const QUOTED = new RegExp(
  String.raw`((["'])${KEY_END}\2\s*:\s*)(["'])((?:\\[\s\S]|[^\\])*?)\3`,
  "gi",
);
const ASSIGN = new RegExp(String.raw`(${KEY}\s*[:=]\s*)([^\r\n"']+)`, "gi");

const SENSITIVE_STEMS = [
  "authorization",
  "apikey",
  "token",
  "secret",
  "password",
  "passwd",
  "cookie",
  "privatekey",
];

function maskToken(value: string): string {
  const text = value.trim();
  if (text.length === 0) return value;
  if (MASKED.test(text)) return text;
  if (text.length <= 16) return MASK;
  return `[redacted:${text.slice(0, 4)}…${text.slice(-4)}]`;
}

function maskValue(value: string): string {
  if (MASKED.test(value)) return value;
  const scheme = /^(Bearer|Basic|Token)\s+(\S.*)$/i.exec(value);
  if (scheme?.[1] !== undefined && scheme[2] !== undefined) {
    return `${scheme[1]} ${maskToken(scheme[2])}`;
  }
  return maskToken(value);
}

function maskSecret(value: unknown): unknown {
  if (typeof value === "string") return maskValue(value);
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return MASK;
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    SENSITIVE_STEMS.some((stem) => normalized === stem || normalized.endsWith(stem)) ||
    (normalized.endsWith("key") && normalized.includes("secret"))
  );
}

export function redact(text: string): string {
  let output = text.replace(PEM, "[redacted:pem]");
  for (const pattern of [JWT, GITHUB, GOOGLE, AWS, OPENAI]) {
    output = output.replace(pattern, (token: string) => maskToken(token));
  }
  output = output.replace(
    QUOTED,
    (_match: string, prefix: string, _keyQuote: string, quote: string, value: string) =>
      `${prefix}${quote}${maskValue(value)}${quote}`,
  );
  output = output.replace(
    ASSIGN,
    (_match: string, prefix: string, value: string) => `${prefix}${maskValue(value)}`,
  );
  output = output.replace(
    BEARER,
    (_match: string, prefix: string, token: string) => `${prefix}${maskToken(token)}`,
  );
  return output;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function replaceKnown(text: string, secrets: readonly string[]): string {
  if (secrets.length === 0) return text;
  let output = text;
  for (const secret of secrets) output = output.split(secret).join(MASK);
  return output;
}

function redactString(text: string, depth: number, secrets: readonly string[]): string {
  if (text.length <= JSON_PARSE_LIMIT) {
    const trimmed = text.trim();
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    const braced = first === "{" && last === "}";
    const arrayed = first === "[" && last === "]";
    if (braced || arrayed) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null) {
          return JSON.stringify(walk(parsed, depth + 1, secrets));
        }
      } catch {
        // Not JSON after all; fall through to textual redaction.
      }
    }
  }
  return redact(replaceKnown(text, secrets));
}

function walk<T>(value: T, depth: number, secrets: readonly string[]): T {
  if (typeof value === "string") return redactString(value, depth, secrets) as T;
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => walk(entry, depth + 1, secrets)) as unknown as T;
  }
  if (typeof value === "object" && value !== null && isPlainObject(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = isSensitiveKey(key) ? maskSecret(entry) : walk(entry, depth + 1, secrets);
    }
    return output as unknown as T;
  }
  return value;
}

export function redactValue<T>(value: T): T {
  return walk(value, 0, []);
}

export function redactKnown<T>(value: T, secrets: readonly string[]): T {
  const known = [...new Set(secrets)]
    .filter((secret) => secret.length >= 4)
    .sort((left, right) => right.length - left.length);
  return walk(value, 0, known);
}
