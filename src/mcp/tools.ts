import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { z } from "zod";
import type { ToolResult } from "../core/types";
import type { Tool } from "../tools/types";
import { isObject } from "../util/json";
import { redact } from "../util/redact";
import type { McpHttpServerConfig, McpServerConfig } from "./config";
import type { StreamableHttpClient } from "./http";
import { mcpMedia } from "./media";

export const MAX_MCP_TOOLS = 128;
const MAX_DESCRIPTION = 2000;
const MAX_SCHEMA_CHARS = 24_000;
const MAX_OUTPUT_CHARS = 2_000_000;

export interface McpToolDefinition {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
}

export interface McpCallToolResult {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean | undefined;
}

export const McpCallToolResultSchema = z.object({
  content: z.array(z.unknown()).optional(),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

export interface McpToolCallOptions {
  signal: AbortSignal;
  timeoutMs: number;
  meta?: Record<string, unknown>;
}

export interface McpToolCaller {
  callTool(
    name: string,
    args: Record<string, unknown>,
    options: McpToolCallOptions,
  ): Promise<McpCallToolResult>;
}

const MAX_TOOL_PAGES = 4;

const HttpToolSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
});

const HttpToolListSchema = z.object({
  tools: z.array(z.unknown()),
  nextCursor: z.string().min(1).optional(),
});

export async function listHttpTools(
  client: StreamableHttpClient,
  config: McpHttpServerConfig,
  signal: AbortSignal,
): Promise<McpToolDefinition[]> {
  const tools: McpToolDefinition[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
    const result = await client.request(
      "tools/list",
      cursor === undefined ? undefined : { cursor },
      { signal, timeoutMs: config.timeoutMs },
    );
    const listed = HttpToolListSchema.safeParse(result);
    if (!listed.success) {
      throw new Error(`MCP tools/list returned invalid data: ${listed.error.message}`);
    }
    for (const item of listed.data.tools) {
      const tool = HttpToolSchema.safeParse(item);
      if (tool.success) tools.push(tool.data);
    }
    const next = listed.data.nextCursor;
    if (next === undefined || tools.length >= config.maxTools) break;
    if (seen.has(next)) throw new Error(`MCP tools/list repeated cursor "${next}"`);
    seen.add(next);
    cursor = next;
  }

  return tools;
}

export function httpToolCaller(client: StreamableHttpClient): McpToolCaller {
  return {
    async callTool(name, args, options) {
      const result = await client.request(
        "tools/call",
        { name, arguments: args, ...(options.meta ? { _meta: options.meta } : {}) },
        { signal: options.signal, timeoutMs: options.timeoutMs },
      );
      const parsed = McpCallToolResultSchema.safeParse(result);
      if (!parsed.success) {
        throw new Error(`MCP tools/call returned invalid data: ${parsed.error.message}`);
      }
      return parsed.data;
    },
  };
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

export function mcpToolName(serverId: string, name: string): string {
  const raw = `mcp_${serverId}_${name}`.replace(/[^A-Za-z0-9_-]/g, "_");
  if (raw.length <= 64) return raw;
  return `${raw.slice(0, 56)}_${shortHash(raw)}`;
}

function byteLength(base64: string): number {
  return Math.max(0, Math.floor((base64.length * 3) / 4));
}

export function mcpBlockText(block: unknown): string {
  if (!isObject(block)) return String(block);
  switch (block.type) {
    case "text":
      return typeof block.text === "string" ? block.text : "";
    case "image":
      return `[image ${typeof block.mimeType === "string" ? block.mimeType : "unknown"}, ${byteLength(typeof block.data === "string" ? block.data : "")} bytes]`;
    case "audio":
      return `[audio ${typeof block.mimeType === "string" ? block.mimeType : "unknown"}, ${byteLength(typeof block.data === "string" ? block.data : "")} bytes]`;
    case "resource_link":
      return `[resource ${typeof block.name === "string" ? block.name : ""}: ${typeof block.uri === "string" ? block.uri : ""}]`;
    case "resource": {
      const resource = isObject(block.resource) ? block.resource : {};
      const uri = typeof resource.uri === "string" ? resource.uri : "";
      if (typeof resource.text === "string") return resource.text;
      if (typeof resource.blob === "string") {
        return `[resource ${uri}, ${byteLength(resource.blob)} bytes]`;
      }
      return `[resource ${uri}]`;
    }
    default:
      return JSON.stringify(block);
  }
}

export function mcpResult(
  result: McpCallToolResult,
  serverId: string,
  toolName: string,
): ToolResult {
  const content = Array.isArray(result.content) ? result.content : [];
  let output = "";
  let truncated = false;
  const append = (part: string): void => {
    if (part.length === 0 || truncated) return;
    const separator = output.length > 0 ? "\n\n" : "";
    const remaining = MAX_OUTPUT_CHARS - output.length - separator.length;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    output += separator + part.slice(0, remaining);
    if (part.length > remaining) truncated = true;
  };
  for (const block of content) append(mcpBlockText(block));
  const message = output;
  if (result.structuredContent !== undefined) {
    append(`Structured result:\n${JSON.stringify(result.structuredContent, null, 2)}`);
  }
  if (truncated) output += "\n\n[MCP output truncated at 2MB]";

  if (result.isError) {
    const error = redact(message || `MCP tool ${serverId}/${toolName} failed without a message`);
    return {
      ok: false,
      output,
      error: error.slice(0, 8000),
      data: {
        kind: "mcp",
        server: serverId,
        tool: toolName,
        ...(result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent }
          : {}),
      },
    };
  }

  return {
    ok: true,
    output: output || "(no output)",
    data: {
      kind: "mcp",
      server: serverId,
      tool: toolName,
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : {}),
    },
  };
}

function toolDescription(serverId: string, tool: McpToolDefinition): string {
  const title = tool.title ? `${tool.title}. ` : "";
  const text = `${title}MCP server "${serverId}". ${tool.description ?? ""}`.trim();
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 3)}...` : text;
}

function parametersOf(tool: McpToolDefinition): Record<string, unknown> | undefined {
  const schema = tool.inputSchema;
  if (!isObject(schema) || schema.type !== "object") return undefined;
  if (JSON.stringify(schema).length > MAX_SCHEMA_CHARS) return undefined;
  const clone = structuredClone(schema);
  delete clone.$schema;
  delete clone.$id;
  return clone;
}

export interface McpToolAccess {
  readOnly?: boolean;
}

const inputValidator = new AjvJsonSchemaValidator();

function invalidInput(tool: McpToolDefinition, args: unknown): string | undefined {
  if (!isObject(args)) return `MCP tool ${tool.name} arguments must be a JSON object`;
  try {
    const validator = inputValidator.getValidator(tool.inputSchema);
    const result = validator(args);
    return result.valid ? undefined : result.errorMessage;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `MCP tool ${tool.name} inputSchema could not validate arguments: ${detail}`;
  }
}

export function createMcpTool(
  serverId: string,
  config: McpServerConfig,
  caller: McpToolCaller,
  tool: McpToolDefinition,
  name: string,
  access: McpToolAccess = {},
): Tool | undefined {
  const parameters = parametersOf(tool);
  if (!parameters) return undefined;
  const readOnly = access.readOnly === true;

  return {
    name,
    description: toolDescription(serverId, tool),
    parameters,
    schema: z.record(z.string(), z.unknown()),
    source: "mcp",
    mutating: true,
    timeoutMs: () => config.timeoutMs,
    provenance: () => ({ source: "mcp", ref: `${serverId}/${tool.name}` }),
    async execute(args, context): Promise<ToolResult> {
      if (readOnly) {
        return {
          ok: false,
          output: "",
          error: `MCP server ${serverId} is read-only; tool ${tool.name} was blocked before execution`,
        };
      }
      if (context.signal.aborted) {
        return { ok: false, output: "", error: "MCP tool aborted" };
      }
      const invalid = invalidInput(tool, args);
      if (invalid !== undefined) {
        return { ok: false, output: "", error: redact(invalid).slice(0, 8000) };
      }
      try {
        const result = await caller.callTool(tool.name, args as Record<string, unknown>, {
          signal: context.signal,
          timeoutMs: config.timeoutMs,
          ...(context.invocationOrigin
            ? { meta: { "flecten.dev/invocation-origin": context.invocationOrigin } }
            : {}),
        });
        const output = mcpResult(result, serverId, tool.name);
        const media = mcpMedia(result.content);
        if (media.length > 0) {
          if (!context.saveMedia) throw new Error("MCP media requires session attachment storage");
          output.attachments = await context.saveMedia(media);
        }
        return output;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          output: "",
          error: redact(`MCP tool ${serverId}/${tool.name} failed: ${detail}`).slice(0, 8000),
        };
      }
    },
  };
}
