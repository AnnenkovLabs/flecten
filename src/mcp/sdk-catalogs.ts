import type { Client } from "@modelcontextprotocol/client";
import type { McpNotification, McpRequestClient, McpRequestOptions } from "./http";

function sdkOptions(options: McpRequestOptions | undefined): {
  signal?: AbortSignal;
  timeout?: number;
} {
  return {
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  };
}

export function sdkRequestClient(client: Client): McpRequestClient {
  return {
    async request<T = unknown>(
      method: string,
      params?: unknown,
      options?: McpRequestOptions,
    ): Promise<T> {
      const requestOptions = sdkOptions(options);
      switch (method) {
        case "resources/list":
          return (await client.listResources(
            params as { cursor?: string } | undefined,
            requestOptions,
          )) as T;
        case "resources/templates/list":
          return (await client.listResourceTemplates(
            params as { cursor?: string } | undefined,
            requestOptions,
          )) as T;
        case "resources/read":
          return (await client.readResource(params as { uri: string }, requestOptions)) as T;
        case "prompts/list":
          return (await client.listPrompts(
            params as { cursor?: string } | undefined,
            requestOptions,
          )) as T;
        case "prompts/get":
          return (await client.getPrompt(
            params as { name: string; arguments?: Record<string, string> },
            requestOptions,
          )) as T;
        default:
          throw new Error(`MCP SDK catalog adapter does not support ${method}`);
      }
    },
    onNotification(handler: (notification: McpNotification) => void): () => void {
      const methods = [
        "notifications/resources/list_changed",
        "notifications/prompts/list_changed",
      ] as const;
      for (const method of methods) {
        client.setNotificationHandler(method, (notification) => {
          handler({ method: notification.method, params: notification.params });
        });
      }
      return () => {
        for (const method of methods) client.removeNotificationHandler(method);
      };
    },
  };
}
