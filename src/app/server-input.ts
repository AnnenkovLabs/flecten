import { isObject } from "../util/json";

export type CommandInput = Record<string, unknown> & { type: string };

const MAX_TEXT = 200_000;

export function required(
  command: CommandInput,
  key: string,
  message = `${key} is required`,
): string {
  const value = command[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(message);
  return value;
}

export function count(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

export function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function flag(command: CommandInput, key: string): boolean {
  const value = command[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`${key} must be true or false`);
  return value;
}

export function page(command: CommandInput): { limit?: number; offset?: number } {
  const limit = count(command.limit, "limit");
  const offset = count(command.offset, "offset");
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  };
}

export function text(command: CommandInput, key: string): string {
  const value = required(command, key);
  if (value.length > MAX_TEXT) throw new Error(`${key} is too long`);
  return value;
}

export function headers(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** Session, queue and client ids are file names: letters, digits, underscore and dash. */
export function isSessionId(value: string): boolean {
  if (value.length === 0 || value.length > 200) return false;
  for (const char of value) {
    const ok =
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      (char >= "0" && char <= "9") ||
      char === "_" ||
      char === "-";
    if (!ok) return false;
  }
  return true;
}

/** An optional id field: absent, or a valid id. */
export function optionalId(command: CommandInput, key: string): string | undefined {
  const value = command[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isSessionId(value)) throw new Error(`${key} is invalid`);
  return value;
}
