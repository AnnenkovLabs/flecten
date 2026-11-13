import { t } from "./i18n.svelte";
import { oneLine, streamingField } from "./partial-json";
import { presentationIcon, toolArgs, toolName, toolSubject } from "./tool-presentation";
import type {
  AgentToolCall,
  AgentToolResult,
  DiffFile,
  FileKind,
  IconName,
  RunAction,
  RunActionDetail,
  TerminalLine,
} from "./types";

export function toolIcon(name: string): IconName {
  return presentationIcon(name);
}

const PREVIEW_KEYS = [
  "path",
  "command",
  "pattern",
  "query",
  "url",
  "prompt",
  "question",
  "name",
  "summary",
];

export function partialArgsPreview(args: string): string {
  const field = streamingField(args, PREVIEW_KEYS);
  return field === undefined ? "" : oneLine(field);
}

const SCRIPT_EXTENSIONS = new Set(
  ["js", "jsx", "ts", "tsx"].flatMap((extension) => [extension, `c${extension}`, `m${extension}`]),
);

/** `name.test.ts`, `name.spec.mjs` and the like. */
function isTestFile(path: string): boolean {
  const parts = path.split(".");
  if (parts.length < 3) return false;
  const marker = parts.at(-2);
  return (marker === "test" || marker === "spec") && SCRIPT_EXTENSIONS.has(parts.at(-1) ?? "");
}

export function fileKind(path: string): FileKind {
  if (isTestFile(path)) return "test";
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  if (extension === "ts" || extension === "tsx" || extension === "mts" || extension === "cts")
    return "ts";
  if (extension === "js" || extension === "jsx" || extension === "mjs" || extension === "cjs")
    return "js";
  if (extension === "css" || extension === "scss") return "css";
  if (extension === "json") return "json";
  if (extension === "md") return "md";
  if (extension === "py") return "py";
  if (extension === "rs") return "rs";
  return "other";
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return t("{0} ms", [Math.max(1, Math.round(ms))]);
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return t("{0} sec", [seconds.toFixed(seconds < 10 ? 1 : 0)]);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return t("{0} min{1}", [minutes, rest > 0 ? t(" {0} s", [rest]) : ""]);
}

export function formatContext(used: number, window: number): string {
  if (used <= 0 || window <= 0) return "0";
  const value = used >= 1000 ? `${Math.round(used / 1000)}k` : String(used);
  const total = window >= 1000 ? `${Math.round(window / 1000)}k` : String(window);
  return `${value} / ${total}`;
}

function argsRecord(call: AgentToolCall): Record<string, unknown> {
  return toolArgs(call.args);
}

function stringArg(call: AgentToolCall, key: string): string | undefined {
  const value = argsRecord(call)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberArg(call: AgentToolCall, key: string): number | undefined {
  const value = argsRecord(call)[key];
  return typeof value === "number" ? value : undefined;
}

export interface FileDiffData {
  kind: "file";
  path: string;
  state: "M" | "A";
  add: number;
  del: number;
  hunks: DiffFile["hunks"];
}

export interface TerminalData {
  kind: "terminal";
  command: string;
  exitCode: number;
  output: string;
  timedOut: boolean;
  aborted: boolean;
}

export interface DoneData {
  kind: "done";
  summary: string;
  evidence: string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function fileDiff(result: AgentToolResult | undefined): FileDiffData | undefined {
  const data = record(result?.data);
  if (data?.kind !== "file") return undefined;
  if (typeof data.path !== "string" || !Array.isArray(data.hunks)) return undefined;
  return {
    kind: "file",
    path: data.path,
    state: data.state === "A" ? "A" : "M",
    add: typeof data.add === "number" ? data.add : 0,
    del: typeof data.del === "number" ? data.del : 0,
    hunks: data.hunks as DiffFile["hunks"],
  };
}

export function terminalData(result: AgentToolResult | undefined): TerminalData | undefined {
  const data = record(result?.data);
  if (data?.kind !== "terminal") return undefined;
  return {
    kind: "terminal",
    command: typeof data.command === "string" ? data.command : "",
    exitCode: typeof data.exitCode === "number" ? data.exitCode : 0,
    output: typeof data.output === "string" ? data.output : "",
    timedOut: data.timedOut === true,
    aborted: data.aborted === true,
  };
}

export function doneData(result: AgentToolResult | undefined): DoneData | undefined {
  const data = record(result?.data);
  if (data?.kind !== "done") return undefined;
  if (typeof data.summary !== "string") return undefined;
  return {
    kind: "done",
    summary: data.summary,
    evidence: Array.isArray(data.evidence)
      ? data.evidence.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

export function baseName(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? path;
}

/** Tools whose `path` names one project file the card can open. */
const FILE_TOOLS: ReadonlySet<string> = new Set(["read", "write", "edit"]);

function actionDetail(
  call: AgentToolCall,
  result: AgentToolResult | undefined,
  durationMs: number,
): RunActionDetail {
  const terminal = terminalData(result);
  const diff = fileDiff(result);
  const elapsed = result?.durationMs ?? durationMs;
  const file = FILE_TOOLS.has(call.name) ? stringArg(call, "path") : undefined;
  const line = call.name === "read" ? numberArg(call, "offset") : undefined;
  return {
    ...(call.args === undefined ? {} : { input: call.args }),
    ...(file ? { file } : {}),
    ...(line !== undefined && line > 1 ? { line } : {}),
    ...(result?.output ? { output: result.output } : {}),
    ...(result?.error ? { error: result.error } : {}),
    ...(result?.data === undefined ? {} : { resultData: result.data }),
    ...(result?.fullOutputPath ? { fullOutputPath: result.fullOutputPath } : {}),
    ...(terminal ? { exitCode: terminal.exitCode } : {}),
    ...(diff ? { hunks: diff.hunks } : {}),
    ...(elapsed > 0 ? { durationMs: elapsed } : {}),
  };
}

export function toolAction(
  call: AgentToolCall,
  result?: AgentToolResult,
  durationMs = 0,
): RunAction {
  const diff = fileDiff(result);
  const data = toolArgs(result?.data);
  const count = typeof data.count === "number" ? data.count : undefined;
  const cancelled = data.cancelled === true || terminalData(result)?.aborted === true;
  return {
    id: call.id,
    tool: call.name,
    icon: toolIcon(call.name),
    get label() {
      return toolName(call.name, call.args);
    },
    subject: toolSubject(call),
    get meta() {
      return count === undefined ? "" : t("Matches: {0}", [count]);
    },
    duration: result ? formatDuration(result.durationMs ?? durationMs) : "",
    state: cancelled ? "cancelled" : result ? (result.ok ? "succeeded" : "failed") : "queued",
    ...(result && !result.ok ? { failed: true } : {}),
    ...(diff ? { add: diff.add, del: diff.del } : {}),
    detail: actionDetail(call, result, durationMs),
  };
}

export function terminalLines(data: TerminalData): TerminalLine[] {
  const lines: TerminalLine[] = [{ prompt: true, text: data.command }];
  const output = data.output.trimEnd();
  if (output.length > 0) {
    for (const line of output.split("\n").slice(-400)) {
      lines.push(data.exitCode === 0 ? { text: line } : { text: line, tone: "muted" });
    }
  }
  if (data.timedOut) lines.push({ text: t("[timed out]"), tone: "muted" });
  else if (data.exitCode !== 0)
    lines.push({ text: t("[exit code {0}]", [data.exitCode]), tone: "muted" });
  return lines;
}

export function usageTotal(input: number, output: number): number {
  return Math.max(0, input + output);
}
