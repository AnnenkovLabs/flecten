export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  idempotencyKey?: string;
  extraContent?: unknown;
}

/** Where tool output came from when the outside world wrote it: a file, a web page, an MCP server or a command. */
export type UntrustedSource = "file" | "web" | "mcp" | "shell";

export interface Provenance {
  source: UntrustedSource;
  /** Path, URL, server/tool or command the data came from, as shown to the model. */
  ref?: string;
}

export interface ToolResult {
  attachments?: import("../attachment-reference").AttachmentReference[];
  ok: boolean;
  /** Data the tool produced. With `provenance` the model receives it wrapped as untrusted data. */
  output: string;
  provenance?: Provenance;
  /** Harness lines shown to the model before the data, for example input repair notes. */
  notice?: string;
  /** Harness lines shown to the model after the data: exit code, duration, full log path. */
  trailer?: string;
  error?: string;
  fullOutputPath?: string;
  durationMs?: number;
  terminate?: boolean;
  data?: unknown;
}
