import type { CommandReportInput } from "./types";

const TRUNCATION_MARKER = "[... output truncated ...]";

function resolveCarriageReturnLine(rawLine: string): string {
  if (!rawLine.includes("\r")) return rawLine;
  const segments = rawLine.split("\r");
  let current = "";
  for (const segment of segments) {
    if (segment.length === 0) continue;
    if (segment.length >= current.length) {
      current = segment;
    } else {
      current = `${segment}${current.slice(segment.length)}`;
    }
  }
  return current;
}

function isPassingTestLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith("(pass) ") ||
    trimmed.startsWith("PASS ") ||
    trimmed.startsWith("✓ ") ||
    trimmed.startsWith("✔ ") ||
    (trimmed.startsWith("test ") && trimmed.endsWith(" ... ok")) ||
    (trimmed.startsWith("ok  \t") && !trimmed.includes("FAIL"))
  );
}

function hasFailureIndicator(lines: readonly string[], exitCode: number | null): boolean {
  if (exitCode !== null && exitCode !== 0) return true;
  return lines.some((line) => {
    const trimmed = line.trimStart();
    return (
      trimmed.startsWith("(fail) ") ||
      trimmed.startsWith("FAIL ") ||
      trimmed.startsWith("FAILED ") ||
      trimmed.startsWith("✗ ") ||
      trimmed.startsWith("✘ ") ||
      trimmed.startsWith("× ") ||
      (trimmed.startsWith("test ") && trimmed.endsWith(" ... FAILED"))
    );
  });
}

function collapsePassingSuitesOnFailure(
  lines: readonly string[],
  exitCode: number | null,
): string[] {
  if (!hasFailureIndicator(lines, exitCode)) return [...lines];

  const out: string[] = [];
  let passBuffer: string[] = [];

  const flushPassBuffer = (): void => {
    if (passBuffer.length === 0) return;
    if (passBuffer.length >= 6) {
      out.push(`... [${passBuffer.length} passing test lines omitted] ...`);
    } else {
      out.push(...passBuffer);
    }
    passBuffer = [];
  };

  for (const line of lines) {
    if (isPassingTestLine(line)) {
      passBuffer.push(line);
      continue;
    }
    flushPassBuffer();
    out.push(line);
  }
  flushPassBuffer();
  return out;
}

export function cleanTerminalStreamText(text: string, exitCode: number | null): string {
  const stripped = Bun.stripANSI(text).replaceAll("\r\n", "\n");
  const resolvedLines = stripped.split("\n").map(resolveCarriageReturnLine);
  while (resolvedLines.length > 0 && (resolvedLines.at(-1) ?? "").trim().length === 0) {
    resolvedLines.pop();
  }
  if (resolvedLines.length === 0) return "";
  const filtered = collapsePassingSuitesOnFailure(resolvedLines, exitCode);
  return filtered.join("\n").trimEnd();
}

export function formatCommandReport(input: CommandReportInput): string {
  const stdout = cleanTerminalStreamText(input.stdout, input.exitCode);
  const stderr = cleanTerminalStreamText(input.stderr, input.exitCode);
  const parts: string[] = [];
  if (stdout.length > 0) parts.push(stdout);
  if (stderr.length > 0) parts.push(parts.length > 0 ? `stderr:\n${stderr}` : stderr);
  const meta: string[] = [];
  if (input.exitCode !== null && input.exitCode !== 0) meta.push(`exit code ${input.exitCode}`);
  if (input.signal) meta.push(`signal ${input.signal}`);
  if (input.timedOut) meta.push("timed out");
  if (meta.length > 0) parts.push(`[${meta.join(", ")}]`);
  if (input.truncated) parts.push(TRUNCATION_MARKER);
  return parts.length > 0 ? `${parts.join("\n\n")}\n` : "(no output)\n";
}
