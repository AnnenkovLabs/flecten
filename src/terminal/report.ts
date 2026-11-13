import type { CommandReportInput } from "./types";

const TRUNCATION_MARKER = "[... output truncated ...]";

function fenced(content: string, language: string): string {
  let fence = "```";
  while (content.includes(fence)) fence += "`";
  return `${fence}${language}\n${content}\n${fence}`;
}

function clean(text: string): string {
  return Bun.stripANSI(text).replaceAll("\r\n", "\n").replaceAll("\r", "").trimEnd();
}

function timestamp(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return new Date(value).toISOString();
}

export function formatCommandReport(input: CommandReportInput): string {
  const stdout = clean(input.stdout);
  const stderr = clean(input.stderr);
  const lines = [
    "command:",
    fenced(input.command, "sh"),
    `cwd: ${input.cwd}`,
    `startedAt: ${timestamp(input.startedAt)}`,
    `durationMs: ${input.durationMs}`,
    `exitCode: ${input.exitCode === null ? "none" : input.exitCode}`,
    `signal: ${input.signal ?? "none"}`,
    `timedOut: ${input.timedOut}`,
    `truncated: ${input.truncated}`,
    "",
    "stdout:",
    fenced(stdout.length > 0 ? stdout : "(empty)", "text"),
    "",
    "stderr:",
    fenced(stderr.length > 0 ? stderr : "(empty)", "text"),
  ];
  if (input.truncated) lines.push("", TRUNCATION_MARKER);
  return `${lines.join("\n")}\n`;
}
