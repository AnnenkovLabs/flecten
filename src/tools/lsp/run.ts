import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolResult } from "../../core/types";
import type { DiffResult } from "../util/diff";
import { displayPath, resolveToolPath } from "../util/paths";
import { LspClient, type LspRequestOptions, type LspServerConfig } from "./client";
import {
  isLspConfig,
  type LspContextConfig,
  languageIdForFile,
  resolveFormatter,
  resolveServer,
} from "./config";
import { runFormatter } from "./formatter";
import {
  collectSymbols,
  diagnosticView,
  formatDiagnostics,
  formatLocations,
  formatRename,
  formatSymbols,
  isRecord,
  type LspSymbol,
  normalizeLocations,
  readWorkspaceEdit,
} from "./results";
import type { LspArgs } from "./schema";

export type {
  LspDiagnosticView,
  LspLocation,
  LspSymbol,
  LspTextEdit,
} from "./results";

export interface LspToolContext {
  cwd: string;
  signal: AbortSignal;
  lsp?: LspContextConfig;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function validate(args: LspArgs): string | undefined {
  if (args.line !== undefined && args.line < 1) return "line must be 1 or greater";
  if (args.character !== undefined && args.character < 1) {
    return "character must be 1 or greater";
  }
  if (args.operation === "rename") {
    if (args.line === undefined || args.character === undefined) {
      return "rename requires line and character (1-based)";
    }
    if (!args.newName) return "rename requires newName";
    return undefined;
  }
  if (args.operation !== "definition" && args.operation !== "references") return undefined;
  if (args.line === undefined || args.character === undefined) {
    return `${args.operation} requires line and character (1-based)`;
  }
  return undefined;
}

function position(args: LspArgs): { line: number; character: number } {
  return { line: (args.line ?? 1) - 1, character: (args.character ?? 1) - 1 };
}

function missingServer(path: string): ToolResult {
  const extension = extname(path).slice(1);
  const target = extension ? `for .${extension} files` : `for ${path}`;
  return {
    ok: false,
    output: "",
    error: `No language server configured ${target}. Add lsp.servers to settings or pass command and args.`,
  };
}

function missingFormatter(path: string): ToolResult {
  const extension = extname(path).slice(1);
  const target = extension ? `for .${extension} files` : `for ${path}`;
  return {
    ok: false,
    output: "",
    error: `No formatter configured ${target}. Add lsp.formatters to settings.`,
  };
}

function lspFailure(error: unknown, command: string): string {
  if (isRecord(error) && error.code === "ENOENT") {
    return `Language server not found: ${command}. Install it or configure lsp.servers.`;
  }
  return asError(error).message;
}

function serverConfig(
  args: LspArgs,
  context: LspToolContext,
  path: string,
): LspServerConfig | undefined {
  const resolved = resolveServer(context.lsp, path, context.cwd);
  if (args.command) {
    const legacy = context.lsp !== undefined && !isLspConfig(context.lsp) ? context.lsp : undefined;
    return {
      command: args.command,
      ...(args.args !== undefined
        ? { args: args.args }
        : resolved?.args !== undefined
          ? { args: resolved.args }
          : legacy?.args !== undefined
            ? { args: legacy.args }
            : {}),
      ...(resolved?.cwd !== undefined ? { cwd: resolved.cwd } : {}),
      ...(resolved?.env !== undefined
        ? { env: resolved.env }
        : legacy?.env !== undefined
          ? { env: legacy.env }
          : {}),
      ...(resolved?.envAllowlist !== undefined
        ? { envAllowlist: resolved.envAllowlist }
        : legacy?.envAllowlist !== undefined
          ? { envAllowlist: legacy.envAllowlist }
          : {}),
      ...(resolved?.requestTimeoutMs !== undefined
        ? { requestTimeoutMs: resolved.requestTimeoutMs }
        : legacy?.requestTimeoutMs !== undefined
          ? { requestTimeoutMs: legacy.requestTimeoutMs }
          : {}),
      ...(resolved?.diagnosticsTimeoutMs !== undefined
        ? { diagnosticsTimeoutMs: resolved.diagnosticsTimeoutMs }
        : legacy?.diagnosticsTimeoutMs !== undefined
          ? { diagnosticsTimeoutMs: legacy.diagnosticsTimeoutMs }
          : {}),
    };
  }
  if (args.args !== undefined) {
    if (!resolved) return undefined;
    return { ...resolved, args: args.args };
  }
  return resolved;
}

function renderFormatDiff(
  file: string,
  formatter: string,
  changed: boolean,
  diff: DiffResult,
): string {
  if (!changed) return `${file}: already formatted with ${formatter}`;
  const header = `format ${file}: +${diff.add} -${diff.del} with ${formatter}`;
  const lines: string[] = [];
  for (const hunk of diff.hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      lines.push(`${prefix}${line.text}`);
    }
  }
  return [header, ...lines].join("\n");
}

async function formatFile(path: string, context: LspToolContext): Promise<ToolResult> {
  const resolved = resolveFormatter(context.lsp, path, context.cwd);
  if (!resolved) return missingFormatter(path);
  const file = displayPath(context.cwd, path);
  const outcome = await runFormatter(resolved, path, context.cwd, file, context.signal);
  if (!outcome.ok) return { ok: false, output: "", error: outcome.error };
  return {
    ok: true,
    output: renderFormatDiff(file, resolved.definition.command, outcome.changed, outcome.diff),
    data: {
      kind: "lsp",
      operation: "format",
      path: file,
      formatter: resolved.definition.command,
      changed: outcome.changed,
      diff: outcome.diff,
    },
  };
}

export async function runLsp(args: LspArgs, context: LspToolContext): Promise<ToolResult> {
  const problem = validate(args);
  if (problem) return { ok: false, output: "", error: problem };

  const path = resolveToolPath(context.cwd, args.path);
  if (args.operation === "format") return formatFile(path, context);

  const config = serverConfig(args, context, path);
  if (!config) return missingServer(path);

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { ok: false, output: "", error: `Cannot read ${args.path}` };
  }

  const file = displayPath(context.cwd, path);
  const uri = pathToFileURL(path).href;
  const requestOptions: LspRequestOptions = {
    signal: context.signal,
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
  };
  // ponytail: one language server process per call. Cache clients by command and root when startup cost matters.
  const client = new LspClient(config, config.cwd ?? context.cwd);

  try {
    await client.initialize(requestOptions);
    client.didOpen(uri, languageIdForFile(path), text);

    switch (args.operation) {
      case "diagnostics": {
        const diagnostics = (await client.waitForDiagnostics(uri, requestOptions)).map((item) =>
          diagnosticView(item, file),
        );
        diagnostics.sort(
          (left, right) =>
            left.line - right.line ||
            left.character - right.character ||
            left.message.localeCompare(right.message),
        );
        return {
          ok: true,
          output: formatDiagnostics(file, diagnostics),
          data: { kind: "lsp", operation: args.operation, path: file, diagnostics },
        };
      }
      case "definition": {
        const result = await client.request(
          "textDocument/definition",
          { textDocument: { uri }, position: position(args) },
          requestOptions,
        );
        const locations = normalizeLocations(result, context.cwd);
        return {
          ok: true,
          output: formatLocations("definition", locations),
          data: { kind: "lsp", operation: args.operation, path: file, locations },
        };
      }
      case "references": {
        const result = await client.request(
          "textDocument/references",
          {
            textDocument: { uri },
            position: position(args),
            context: { includeDeclaration: true },
          },
          requestOptions,
        );
        const locations = normalizeLocations(result, context.cwd);
        return {
          ok: true,
          output: formatLocations("references", locations),
          data: { kind: "lsp", operation: args.operation, path: file, locations },
        };
      }
      case "symbols": {
        const result = await client.request(
          "textDocument/documentSymbol",
          { textDocument: { uri } },
          requestOptions,
        );
        const symbols: LspSymbol[] = [];
        const items = Array.isArray(result) ? result : result === null ? [] : [result];
        for (const item of items) collectSymbols(item, file, symbols);
        return {
          ok: true,
          output: formatSymbols(file, symbols),
          data: { kind: "lsp", operation: args.operation, path: file, symbols },
        };
      }
      case "rename": {
        const result = await client.request(
          "textDocument/rename",
          { textDocument: { uri }, position: position(args), newName: args.newName ?? "" },
          requestOptions,
        );
        const edits = readWorkspaceEdit(result, context.cwd);
        return {
          ok: true,
          output: formatRename(edits),
          data: { kind: "lsp", operation: args.operation, path: file, edits },
        };
      }
      default:
        return { ok: false, output: "", error: `Unsupported operation: ${args.operation}` };
    }
  } catch (error) {
    return { ok: false, output: "", error: lspFailure(error, config.command) };
  } finally {
    await client.shutdown();
  }
}
