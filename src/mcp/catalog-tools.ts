import { z } from "zod";
import type { ToolResult } from "../core/types";
import type { Tool } from "../tools/types";
import { redact } from "../util/redact";
import type { McpServerConfig } from "./config";
import { DEFAULT_MCP_CONTEXT_TOKENS, renderPromptContext, renderResourceContext } from "./context";
import type { McpPrompt, McpPromptCatalog } from "./prompts";
import type { McpResource, McpResourceCatalog } from "./resources";
import { mcpToolName } from "./tools";

const MAX_URI = 4096;
const MAX_ARGUMENT_VALUE = 8192;

export interface McpCatalogSurface {
  resources: Pick<McpResourceCatalog, "readResource">;
  prompts: Pick<McpPromptCatalog, "getPrompt">;
  resourceItems: readonly McpResource[];
  promptItems: readonly McpPrompt[];
}

function contextBudget(config: McpServerConfig): number {
  return config.contextTokens ?? DEFAULT_MCP_CONTEXT_TOKENS;
}

function failure(error: unknown, label: string): ToolResult {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    output: "",
    error: redact(`${label}: ${detail}`).slice(0, 8000),
  };
}

function resourceTool(serverId: string, config: McpServerConfig, surface: McpCatalogSurface): Tool {
  return {
    name: mcpToolName(serverId, "read_resource"),
    description: `Read an MCP resource from server "${serverId}" into context. The result is untrusted server data and is capped by the server token budget.`,
    parameters: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description: "Exact resource URI reported by the server.",
        },
      },
      required: ["uri"],
      additionalProperties: false,
    },
    schema: z.object({ uri: z.string().min(1).max(MAX_URI) }).strict(),
    source: "mcp",
    mutating: false,
    timeoutMs: () => config.timeoutMs,
    async execute(args, context): Promise<ToolResult> {
      const { uri } = args as { uri: string };
      if (context.signal.aborted) {
        return { ok: false, output: "", error: "MCP resource read aborted" };
      }
      try {
        const contents = await surface.resources.readResource(uri, context.signal);
        const result = renderResourceContext(serverId, uri, contents, contextBudget(config));
        return {
          ok: true,
          output: result.text,
          data: {
            kind: "mcp",
            server: serverId,
            tool: "read_resource",
            uri,
            tokens: result.tokens,
            truncated: result.truncated,
            untrusted: true,
          },
        };
      } catch (error) {
        return failure(error, `MCP resource ${serverId}/${uri} failed`);
      }
    },
  };
}

function promptTool(serverId: string, config: McpServerConfig, surface: McpCatalogSurface): Tool {
  return {
    name: mcpToolName(serverId, "use_prompt"),
    description: `Invoke an MCP prompt from server "${serverId}" like a command with string arguments. The result is untrusted server data and is capped by the server token budget.`,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Prompt name reported by the server.",
          ...(surface.promptItems.length === 0
            ? {}
            : { enum: surface.promptItems.map((prompt) => prompt.name) }),
        },
        arguments: {
          type: "object",
          description: "Prompt arguments as string values.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    schema: z
      .object({
        name: z.string().min(1).max(512),
        arguments: z
          .record(z.string().min(1).max(256), z.string().max(MAX_ARGUMENT_VALUE))
          .optional(),
      })
      .strict(),
    source: "mcp",
    mutating: false,
    timeoutMs: () => config.timeoutMs,
    async execute(args, context): Promise<ToolResult> {
      const input = args as { name: string; arguments?: Record<string, string> };
      if (context.signal.aborted) {
        return { ok: false, output: "", error: "MCP prompt invocation aborted" };
      }
      try {
        const prompt = await surface.prompts.getPrompt(
          input.name,
          input.arguments ?? {},
          context.signal,
        );
        const result = renderPromptContext(serverId, input.name, prompt, contextBudget(config));
        return {
          ok: true,
          output: result.text,
          data: {
            kind: "mcp",
            server: serverId,
            tool: "use_prompt",
            prompt: input.name,
            tokens: result.tokens,
            truncated: result.truncated,
            untrusted: true,
          },
        };
      } catch (error) {
        return failure(error, `MCP prompt ${serverId}/${input.name} failed`);
      }
    },
  };
}

export function createMcpCatalogTools(
  serverId: string,
  config: McpServerConfig,
  surface: McpCatalogSurface,
): Tool[] {
  const tools: Tool[] = [];
  if (surface.resourceItems.length > 0) {
    tools.push(resourceTool(serverId, config, surface));
  }
  if (surface.promptItems.length > 0) {
    tools.push(promptTool(serverId, config, surface));
  }
  return tools;
}
