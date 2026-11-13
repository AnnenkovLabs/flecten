import type { Client, Tool as McpTool } from "@modelcontextprotocol/client";
import type { LoadedTool, McpConnection } from "./connection";
import { httpToolCaller, type McpToolCaller } from "./tools";

function sdkCaller(client: Client, tool: McpTool): McpToolCaller {
  const toolDefinition = { ...tool };
  // A server's schema mismatch must not turn a completed mutation into a retryable failure.
  // The SDK still validates the MCP result envelope; inputs are checked before execution.
  delete toolDefinition.outputSchema;
  return {
    callTool(name, args, options) {
      return client.callTool(
        { name, arguments: args, ...(options.meta ? { _meta: options.meta } : {}) },
        {
          signal: options.signal,
          timeout: options.timeoutMs,
          toolDefinition,
        },
      );
    },
  };
}

export function callerFor(connection: McpConnection, loaded: LoadedTool): McpToolCaller {
  if (connection.sdk !== undefined && loaded.sdk !== undefined) {
    return sdkCaller(connection.sdk, loaded.sdk);
  }
  if (connection.httpClient !== undefined) return httpToolCaller(connection.httpClient);
  throw new Error(`MCP server ${connection.id} has no client`);
}
