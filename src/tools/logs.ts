import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { redactKnown } from "../util/redact";
import { truncateLines, truncateMiddle } from "../util/truncate";
import type { ToolLimits } from "./types";

export interface ToolLog {
  excerpt: string;
  path: string;
}

export interface ToolLogInput {
  toolName: string;
  callId: string;
  text: string;
  logDir: string;
  limits: ToolLimits;
  existingPath?: string;
  secrets?: readonly string[];
}

function sanitizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "tool";
}

export async function writeToolLog(input: ToolLogInput): Promise<ToolLog> {
  const name = `${sanitizeName(input.toolName)}-${sanitizeName(input.callId)}-${crypto.randomUUID()}.log`;
  const path = input.existingPath ?? join(input.logDir, name);
  if (!input.existingPath) {
    await mkdir(input.logDir, { recursive: true });
    await Bun.write(path, redactKnown(input.text, input.secrets ?? []));
  }
  const byLines = truncateLines(input.text, input.limits.maxOutputLines);
  const byBytes = truncateMiddle(byLines.text, input.limits.maxOutputBytes);
  return { excerpt: byBytes.text, path };
}
