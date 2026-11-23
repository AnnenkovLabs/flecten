import { ZodError } from "zod";
import type { ToolResult } from "../core/types";
import { HarnessError, LimitError, MissingKeyError, ProjectLockedError } from "../errors";
import { ProviderResponseError } from "../providers/response";
import { TransportError } from "../providers/transport";
import { ToolFailure } from "../tools/types";
import { isObject } from "../util/json";
import { redact } from "../util/redact";

export interface FailureClassification {
  error_kind: string;
  error_name?: string;
  error_code?: string;
  http_status?: number;
  provider_code?: string;
  limit_kind?: string;
  response_outcome?: string;
  retryable?: boolean;
}

export interface ToolFailureDetail {
  error_kind: string;
  exit_code?: number;
  http_status?: number;
  errno?: string;
  hook_event?: string;
  approval_by?: string;
}

const KNOWN_TOOL_FAILURE_KINDS = new Set([
  "timeout",
  "aborted",
  "permission",
  "sandbox",
  "approval",
  "hook",
  "transient",
  "client",
  "validation",
  "mcp_inactive",
  "unknown_tool",
  "invalid_args",
]);

export function safeCodeToken(value: string): string {
  return redact(value).trim().slice(0, 64);
}

function errnoCodeOf(error: unknown): string | undefined {
  if (!isObject(error)) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" && typeof code !== "number") return undefined;
  const token = safeCodeToken(String(code));
  return token.length > 0 ? token : undefined;
}

function errorNameOf(error: unknown): string {
  if (error instanceof Error) return safeCodeToken(error.name) || "Error";
  if (isObject(error) && typeof error.name === "string") {
    return safeCodeToken(error.name) || "Error";
  }
  return "Error";
}

/** Classifies an arbitrary thrown error into typed diagnostic fields without raw messages or PII. */
export function classifyFailure(error: unknown): FailureClassification {
  if (error instanceof MissingKeyError) {
    return {
      error_kind: "missing_api_key",
      error_code: error.code,
      error_name: error.name,
    };
  }
  if (error instanceof LimitError) {
    return {
      error_kind: "provider_limit",
      error_code: error.code,
      limit_kind: error.limit,
      error_name: error.name,
    };
  }
  if (error instanceof ProviderResponseError) {
    return {
      error_kind: "provider_stream",
      error_code: error.code,
      response_outcome: safeCodeToken(error.response.outcome) || "unknown",
      retryable: error.retryable,
      error_name: error.name,
    };
  }
  if (error instanceof TransportError) {
    return {
      error_kind: `transport_${error.reason}`,
      error_code: error.code,
      ...(typeof error.status === "number" ? { http_status: error.status } : {}),
      ...(error.providerCode ? { provider_code: safeCodeToken(error.providerCode) } : {}),
      ...(error.limitKind ? { limit_kind: error.limitKind } : {}),
      retryable: error.retryable,
      error_name: error.name,
    };
  }
  if (error instanceof ToolFailure) {
    return {
      error_kind: `tool_${error.kind}`,
      error_name: error.name,
    };
  }
  if (error instanceof HarnessError) {
    return {
      error_kind: error.code,
      error_code: error.code,
      error_name: error.name,
    };
  }
  if (error instanceof ProjectLockedError) {
    return {
      error_kind: "project_locked",
      error_name: error.name,
    };
  }
  if (error instanceof ZodError) {
    const issueCode = error.issues[0]?.code;
    return {
      error_kind: "validation_error",
      ...(issueCode ? { error_code: safeCodeToken(issueCode) } : {}),
      error_name: "ZodError",
    };
  }
  const error_name = errorNameOf(error);
  if (error_name === "AbortError") {
    return { error_kind: "aborted", error_name: "AbortError" };
  }
  const errno = errnoCodeOf(error);
  if (errno) {
    return {
      error_kind: "os_error",
      error_code: errno,
      error_name,
    };
  }
  return {
    error_kind: "runtime_error",
    error_name,
  };
}

/** Extracts exact failure kind and non-PII diagnostic codes from a failed tool result. */
export function classifyToolFailureDetail(result: ToolResult): ToolFailureDetail {
  if (!isObject(result.data)) return { error_kind: "execution_error" };
  const data = result.data;
  const exit_code =
    typeof data.exitCode === "number" && Number.isFinite(data.exitCode) && data.exitCode !== 0
      ? data.exitCode
      : undefined;
  const http_status =
    typeof data.status === "number" && Number.isFinite(data.status) ? data.status : undefined;
  const rawErrorCode = typeof data.errorCode === "string" ? safeCodeToken(data.errorCode) : "";
  const errno = rawErrorCode.length > 0 ? rawErrorCode : undefined;
  const rawKind = typeof data.kind === "string" ? data.kind : undefined;
  const rawHookEvent =
    rawKind === "hook" && typeof data.event === "string" ? safeCodeToken(data.event) : "";
  const hook_event = rawHookEvent.length > 0 ? rawHookEvent : undefined;
  const rawApprovalBy =
    rawKind === "approval" && typeof data.by === "string" ? safeCodeToken(data.by) : "";
  const approval_by = rawApprovalBy.length > 0 ? rawApprovalBy : undefined;

  let error_kind: string | undefined;
  const errorKind = typeof data.errorKind === "string" ? data.errorKind : undefined;
  if (errorKind && KNOWN_TOOL_FAILURE_KINDS.has(errorKind)) error_kind = errorKind;
  else if (rawKind && KNOWN_TOOL_FAILURE_KINDS.has(rawKind)) error_kind = rawKind;
  else if (data.timedOut === true) error_kind = "timeout";
  else if (data.aborted === true) error_kind = "aborted";
  else if (http_status !== undefined && http_status >= 500 && http_status <= 599) {
    error_kind = "transient";
  } else if (http_status !== undefined && http_status >= 400 && http_status <= 499) {
    error_kind = "client";
  } else if (errno !== undefined) {
    error_kind = "os_error";
  } else if (exit_code !== undefined) {
    error_kind = "exit_nonzero";
  }

  return {
    error_kind: error_kind ?? "execution_error",
    ...(exit_code !== undefined ? { exit_code } : {}),
    ...(http_status !== undefined ? { http_status } : {}),
    ...(errno !== undefined ? { errno } : {}),
    ...(hook_event !== undefined ? { hook_event } : {}),
    ...(approval_by !== undefined ? { approval_by } : {}),
  };
}
