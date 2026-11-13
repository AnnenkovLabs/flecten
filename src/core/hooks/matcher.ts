import { resolve, sep } from "node:path";
import type { CanonicalHookMatcher, HookDefinition, HookInput } from "./types";

const PATH_FIELDS = ["path", "file_path", "filePath", "paths", "source", "destination", "target"];
const COMMAND_FIELDS = ["command", "cmd"];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function canonicalToolNames(input: HookInput): string[] {
  const names = new Set<string>();
  if (input.toolName) names.add(input.toolName);
  if (input.permission?.tool) names.add(input.permission.tool);
  for (const tool of input.toolBatch?.tools ?? []) names.add(tool.name);
  return [...names];
}

export function canonicalPaths(input: HookInput): string[] {
  const args = asRecord(input.toolArgs);
  const values = new Set<string>();
  for (const field of PATH_FIELDS) {
    for (const value of asStrings(args?.[field])) values.add(resolve(input.cwd, value));
  }
  if (input.target) values.add(resolve(input.cwd, input.target));
  if (
    input.permission?.target &&
    ["read", "write", "external_path"].includes(input.permission.action)
  )
    values.add(resolve(input.cwd, input.permission.target));
  return [...values];
}

export function canonicalCommands(input: HookInput): string[] {
  const args = asRecord(input.toolArgs);
  const values = new Set<string>();
  for (const field of COMMAND_FIELDS) {
    for (const value of asStrings(args?.[field])) values.add(value);
  }
  if (input.permission?.action === "shell" && input.permission.target)
    values.add(input.permission.target);
  return [...values];
}

function matchesTool(expected: string | undefined, actual: string[]): boolean {
  if (expected === undefined || expected === "*") return true;
  return actual.includes(expected);
}

function matchesPath(expected: string, actual: string): boolean {
  return expected === actual;
}

function matchesPathPrefix(prefix: string, actual: string): boolean {
  const base = prefix.endsWith(sep) ? prefix.slice(0, -sep.length) : prefix;
  return actual === base || actual.startsWith(`${base}${sep}`);
}

function matchesCommandPrefix(prefix: string, actual: string): boolean {
  const base = prefix.trimEnd();
  if (actual === base) return true;
  if (!actual.startsWith(base)) return false;
  const next = actual.charAt(base.length);
  return next === " " || next === "\t";
}

function matchesCanonical(matcher: CanonicalHookMatcher, input: HookInput): boolean {
  if (!matchesTool(matcher.tool, canonicalToolNames(input))) return false;

  if (matcher.path !== undefined) {
    const expected = resolve(input.cwd, matcher.path);
    if (!canonicalPaths(input).some((path) => matchesPath(expected, path))) return false;
  }

  if (matcher.pathPrefix !== undefined) {
    const expected = resolve(input.cwd, matcher.pathPrefix);
    if (!canonicalPaths(input).some((path) => matchesPathPrefix(expected, path))) return false;
  }

  if (matcher.command !== undefined) {
    if (!canonicalCommands(input).includes(matcher.command)) return false;
  }

  if (matcher.commandPrefix !== undefined) {
    if (
      !canonicalCommands(input).some((command) =>
        matchesCommandPrefix(matcher.commandPrefix ?? "", command),
      )
    )
      return false;
  }

  return true;
}

export function matcherMatches(hook: HookDefinition, input: HookInput): boolean {
  const matcher = hook.matcher;
  if (typeof matcher === "string") {
    if (matcher === "*") return true;
    return canonicalToolNames(input).includes(matcher);
  }
  if (matcher === undefined) return true;
  if (input.toolBatch) {
    return input.toolBatch.tools.some((tool) =>
      matchesCanonical(matcher, {
        sessionId: input.sessionId,
        cwd: input.cwd,
        toolName: tool.name,
        toolArgs: tool.args,
      }),
    );
  }
  return matchesCanonical(matcher, input);
}
