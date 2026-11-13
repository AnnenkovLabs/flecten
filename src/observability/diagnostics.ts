import { homedir } from "node:os";
import { sep } from "node:path";
import { redact } from "../util/redact";
import { redactDeep } from "./redact";

/** One structured log line kept for crash reports and diagnostics bundles. */
export interface LogRecord {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  traceId: string;
  sessionId?: string;
  durationMs?: number;
  errorCode?: string;
  data: Record<string, unknown>;
}

export interface ErrorDetails {
  name: string;
  message: string;
  code?: string;
  stack?: string;
}

export interface CrashReport {
  ts: string;
  error: ErrorDetails;
  traceId: string;
  sessionId?: string;
  version?: string;
  recentLogs: LogRecord[];
}

export interface CrashReportInput {
  error: unknown;
  traceId: string;
  now?: Date;
  sessionId?: string;
  version?: string;
  recentLogs?: LogRecord[];
  maxLogs?: number;
}

export function describeError(error: unknown): ErrorDetails {
  if (error instanceof Error) {
    const details: ErrorDetails = {
      name: redact(error.name),
      message: redact(error.message),
    };
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") details.code = redact(String(code));
    if (error.stack !== undefined) details.stack = redact(error.stack);
    return details;
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const message =
      typeof record.message === "string"
        ? redact(record.message)
        : redact(JSON.stringify(redactDeep(record)));
    const details: ErrorDetails = {
      name: typeof record.name === "string" ? redact(record.name) : "Error",
      message,
    };
    const code = record.code;
    if (typeof code === "string" || typeof code === "number") details.code = redact(String(code));
    if (typeof record.stack === "string") details.stack = redact(record.stack);
    return details;
  }

  return { name: "Error", message: redact(String(error)) };
}

export function buildCrashReport(input: CrashReportInput): CrashReport {
  const report: CrashReport = {
    ts: (input.now ?? new Date()).toISOString(),
    error: describeError(input.error),
    traceId: redact(input.traceId),
    recentLogs: (input.recentLogs ?? []).slice(-(input.maxLogs ?? 50)),
  };
  if (input.sessionId !== undefined) report.sessionId = redact(input.sessionId);
  if (input.version !== undefined) report.version = redact(input.version);
  return redactDeep(report) as CrashReport;
}

export interface ProviderSummary {
  name: string;
  protocol?: string;
  host?: string;
  apiKeyEnv?: string;
}

export interface ShapeNode {
  type: string;
  keys?: Record<string, ShapeNode>;
  length?: number;
  items?: ShapeNode;
}

export interface DiagnosticsInput {
  version: string;
  commit: string;
  paths: Record<string, string>;
  providers: Array<Record<string, unknown>>;
  recentErrors: unknown[];
  config: Record<string, unknown>;
  now?: Date;
  platform?: string;
  maxErrors?: number;
}

export interface DiagnosticsBundle {
  schemaVersion: 1;
  createdAt: string;
  app: {
    version: string;
    commit: string;
    platform: string;
  };
  paths: Record<string, string>;
  providers: ProviderSummary[];
  recentErrors: ErrorDetails[];
  configShape: ShapeNode;
}

const MAX_SHAPE_DEPTH = 4;
const MAX_SHAPE_KEYS = 40;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? redact(value) : undefined;
}

function providerHost(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function summarizeProvider(provider: Record<string, unknown>, index: number): ProviderSummary {
  const summary: ProviderSummary = {
    name: optionalString(provider.name) ?? optionalString(provider.id) ?? `provider-${index + 1}`,
  };
  const protocol = optionalString(provider.protocol);
  if (protocol !== undefined) summary.protocol = protocol;
  const host = providerHost(provider.baseUrl);
  if (host !== undefined) summary.host = host;
  const apiKeyEnv = optionalString(provider.apiKeyEnv);
  if (apiKeyEnv !== undefined) summary.apiKeyEnv = apiKeyEnv;
  return summary;
}

function sanitizePath(value: string): string {
  const safe = redact(value);
  const home = homedir();
  const prefix = home.endsWith(sep) ? home : `${home}${sep}`;
  if (home.length > 1 && safe === home) return "~";
  if (home.length > 1 && safe.startsWith(prefix)) return `~${safe.slice(home.length)}`;
  return safe;
}

export function describeConfigShape(value: unknown, depth = 0): ShapeNode {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    const node: ShapeNode = { type: "array", length: value.length };
    const first = value[0];
    if (first !== undefined && depth < MAX_SHAPE_DEPTH) {
      node.items = describeConfigShape(first, depth + 1);
    }
    return node;
  }
  if (typeof value === "object") {
    if (depth >= MAX_SHAPE_DEPTH) return { type: "object" };
    const keys = Object.keys(value as Record<string, unknown>)
      .sort()
      .slice(0, MAX_SHAPE_KEYS);
    const node: ShapeNode = { type: "object" };
    if (keys.length > 0) {
      const children: Record<string, ShapeNode> = Object.create(null) as Record<string, ShapeNode>;
      for (const key of keys) {
        children[redact(key)] = describeConfigShape(
          (value as Record<string, unknown>)[key],
          depth + 1,
        );
      }
      node.keys = children;
    }
    return node;
  }
  return { type: typeof value };
}

export function buildDiagnosticsBundle(input: DiagnosticsInput): DiagnosticsBundle {
  const paths: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.paths)) {
    paths[redact(name)] = sanitizePath(value);
  }
  const errors = input.recentErrors.slice(-(input.maxErrors ?? 20)).map(describeError);
  const bundle: DiagnosticsBundle = {
    schemaVersion: 1,
    createdAt: (input.now ?? new Date()).toISOString(),
    app: {
      version: redact(input.version),
      commit: redact(input.commit),
      platform: redact(input.platform ?? process.platform),
    },
    paths,
    providers: input.providers.map(summarizeProvider),
    recentErrors: errors,
    configShape: describeConfigShape(input.config),
  };
  return bundle;
}
