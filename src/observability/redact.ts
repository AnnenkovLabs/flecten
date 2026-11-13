import { redact } from "../util/redact";

const MAX_DEPTH = 8;

function normalizeKey(key: string): string {
  return key.toLowerCase().split("_").join("").split("-").join("");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "headers" ||
    normalized === "password" ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token")
  );
}

function sanitize(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (typeof value === "string") return redact(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    const error: Record<string, unknown> = {
      name: value.name,
      message: redact(value.message),
    };
    if (value.stack !== undefined) error.stack = redact(value.stack);
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") error.code = String(code);
    return error;
  }
  if (typeof value !== "object") return "[unsupported]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitize(item, seen, depth + 1));
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      const sensitive = isSensitiveKey(key);
      const safeKey = sensitive ? key : redact(key);
      result[safeKey] = sensitive ? "[redacted]" : sanitize(item, seen, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function redactDeep(value: unknown): unknown {
  return sanitize(value, new WeakSet<object>(), 0);
}
