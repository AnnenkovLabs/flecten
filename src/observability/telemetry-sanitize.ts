import type { ToolResult } from "../core/types";
import { isObject } from "../util/json";
import { redact } from "../util/redact";
import { classifyToolFailureDetail } from "./telemetry-errors";

const BUILTIN_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "apply_patch",
  "delete",
  "move",
  "todo",
  "task",
  "grep",
  "glob",
  "ask",
  "web_fetch",
  "web_search",
  "terminal",
  "bash",
  "jobs",
  "done",
  "memory",
  "context",
  "skill",
  "module",
  "tool_catalog",
]);

const BUILTIN_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "deepseek",
  "moonshotai",
  "zai",
  "alibaba",
  "groq",
  "cerebras",
  "ollama",
]);

const MAX_STRING_LENGTH = 128;

export function normalizeToolName(name: string): string {
  if (BUILTIN_TOOLS.has(name)) return name;
  if (name.startsWith("mcp_")) return "mcp";
  return "module_tool";
}

export function normalizeProvider(providerId: string): string {
  return BUILTIN_PROVIDERS.has(providerId) ? providerId : "custom";
}

export function normalizeModel(providerId: string, model: string): string {
  if (!BUILTIN_PROVIDERS.has(providerId)) return "custom";
  const safe = redact(model).trim().slice(0, 96);
  return safe.length > 0 ? safe : "unknown";
}

export function classifyToolFailure(result: ToolResult): string {
  return classifyToolFailureDetail(result).error_kind;
}

export function classifyError(error: unknown): { error_name: string; error_code?: string } {
  if (error instanceof Error) {
    const rawName = redact(error.name).trim().slice(0, 64);
    const code = (error as { code?: unknown }).code;
    const safeCode =
      typeof code === "string" || typeof code === "number"
        ? redact(String(code)).trim().slice(0, 64)
        : "";
    return {
      error_name: rawName || "Error",
      ...(safeCode ? { error_code: safeCode } : {}),
    };
  }
  if (isObject(error)) {
    const rawName = typeof error.name === "string" ? redact(error.name).trim().slice(0, 64) : "";
    const code = error.code;
    const safeCode =
      typeof code === "string" || typeof code === "number"
        ? redact(String(code)).trim().slice(0, 64)
        : "";
    return {
      error_name: rawName || "Error",
      ...(safeCode ? { error_code: safeCode } : {}),
    };
  }
  return { error_name: "Error" };
}

export function sanitizeProperties(
  input: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "boolean") {
      output[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) output[key] = value;
      continue;
    }
    if (typeof value === "string") {
      output[key] = redact(value).slice(0, MAX_STRING_LENGTH);
    }
  }
  return output;
}
