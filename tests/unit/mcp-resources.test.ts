import { afterEach, describe, expect, test } from "bun:test";
import { StreamableHttpClient } from "../../src/mcp/http";
import { McpPromptCatalog } from "../../src/mcp/prompts";
import { McpResourceCatalog } from "../../src/mcp/resources";

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

const servers: Array<ReturnType<typeof Bun.serve>> = [];

function startServer(
  fetch: (request: Request) => Response | Promise<Response>,
): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({ port: 0, fetch });
  servers.push(server);
  return server;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function jsonResult(id: number | string | undefined, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "content-type": "application/json" },
  });
}

function sse(messages: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const message of messages) {
          controller.enqueue(
            encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`),
          );
        }
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function initializeResult(message: RpcRequest): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2026-07-28",
        capabilities: { resources: {}, prompts: {} },
        serverInfo: { name: "catalog", version: "1.0.0" },
      },
    }),
    {
      headers: {
        "content-type": "application/json",
        "mcp-session-id": "catalog-session",
      },
    },
  );
}

async function rpc(request: Request): Promise<RpcRequest> {
  return (await request.json()) as RpcRequest;
}

describe("MCP resources and prompts", () => {
  test("paginates resources, reads typed content and reacts to list_changed", async () => {
    const resourceCursors: Array<string | undefined> = [];
    const templateCursors: Array<string | undefined> = [];
    let notifyNextResources = false;

    const server = startServer(async (request) => {
      const message = await rpc(request);
      switch (message.method) {
        case "initialize":
          return initializeResult(message);
        case "notifications/initialized":
          return new Response(null, { status: 202 });
        case "resources/list": {
          const cursor = message.params?.cursor as string | undefined;
          resourceCursors.push(cursor);
          const result =
            cursor === undefined
              ? {
                  resources: [{ uri: "file:///a", name: "A", mimeType: "text/plain" }],
                  nextCursor: "page-2",
                }
              : { resources: [{ uri: "file:///b", name: "B" }] };
          if (notifyNextResources) {
            notifyNextResources = false;
            return sse([
              { jsonrpc: "2.0", method: "notifications/resources/list_changed" },
              { jsonrpc: "2.0", id: message.id, result },
            ]);
          }
          return jsonResult(message.id, result);
        }
        case "resources/templates/list": {
          const cursor = message.params?.cursor as string | undefined;
          templateCursors.push(cursor);
          return jsonResult(
            message.id,
            cursor === undefined
              ? {
                  resourceTemplates: [{ uriTemplate: "file:///{path}", name: "file" }],
                  nextCursor: "templates-2",
                }
              : {
                  resourceTemplates: [
                    { uriTemplate: "docs:///{page}", name: "page", mimeType: "text/markdown" },
                  ],
                },
          );
        }
        case "resources/read": {
          const uri = message.params?.uri;
          return jsonResult(
            message.id,
            uri === "file:///blob"
              ? {
                  contents: [{ uri, mimeType: "application/octet-stream", blob: "aGVsbG8=" }],
                }
              : { contents: [{ uri, mimeType: "text/plain", text: "hello" }] },
          );
        }
        case "prompts/list": {
          const cursor = message.params?.cursor as string | undefined;
          return jsonResult(
            message.id,
            cursor === undefined
              ? {
                  prompts: [
                    {
                      name: "greet",
                      arguments: [{ name: "name", required: true }],
                    },
                  ],
                  nextCursor: "prompts-2",
                }
              : { prompts: [{ name: "summarize" }] },
          );
        }
        case "prompts/get": {
          const args = message.params?.arguments as Record<string, unknown> | undefined;
          return jsonResult(message.id, {
            description: "Greeting prompt",
            messages: [
              {
                role: "user",
                content: { type: "text", text: `Hello ${args?.name}` },
              },
              {
                role: "assistant",
                content: {
                  type: "resource",
                  resource: { uri: "file:///a", text: "resource text" },
                },
              },
            ],
          });
        }
        default:
          return new Response("not found", { status: 404 });
      }
    });

    const client = new StreamableHttpClient({ url: server.url.toString() });
    await client.connect();
    const resources = new McpResourceCatalog(client);
    const prompts = new McpPromptCatalog(client);
    let changes = 0;
    resources.onChange(() => {
      changes += 1;
    });

    const first = await resources.listAllResources();
    expect(first.map((resource) => resource.uri)).toEqual(["file:///a", "file:///b"]);
    expect(resourceCursors).toEqual([undefined, "page-2"]);

    const templates = await resources.listAllResourceTemplates();
    expect(templates.map((template) => template.uriTemplate)).toEqual([
      "file:///{path}",
      "docs:///{page}",
    ]);
    expect(templateCursors).toEqual([undefined, "templates-2"]);

    const text = await resources.readResource("file:///a");
    expect(text).toEqual([
      { kind: "text", uri: "file:///a", mimeType: "text/plain", text: "hello" },
    ]);
    const blob = await resources.readResource("file:///blob");
    expect(blob).toEqual([
      {
        kind: "blob",
        uri: "file:///blob",
        mimeType: "application/octet-stream",
        blob: "aGVsbG8=",
      },
    ]);

    notifyNextResources = true;
    await resources.listResources();
    expect(changes).toBe(1);
    const refreshed = await resources.listAllResources();
    expect(refreshed).toHaveLength(2);
    expect(resourceCursors).toEqual([undefined, "page-2", undefined, undefined, "page-2"]);

    const promptList = await prompts.listAllPrompts();
    expect(promptList.map((prompt) => prompt.name)).toEqual(["greet", "summarize"]);
    const prompt = await prompts.getPrompt("greet", { name: "Sasha" });
    expect(prompt.description).toBe("Greeting prompt");
    expect(prompt.messages[0]).toEqual({
      role: "user",
      content: { type: "text", text: "Hello Sasha" },
    });
    expect(prompt.messages[1]).toEqual({
      role: "assistant",
      content: {
        type: "resource",
        resource: { kind: "text", uri: "file:///a", text: "resource text" },
      },
    });

    resources.close();
    prompts.close();
    await client.close();
  });

  test("stops pagination on a repeated cursor", async () => {
    const server = startServer(async (request) => {
      const message = await rpc(request);
      if (message.method === "initialize") return initializeResult(message);
      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (message.method === "resources/list") {
        return jsonResult(message.id, {
          resources: [{ uri: "file:///loop", name: "loop" }],
          nextCursor: "same",
        });
      }
      return new Response("not found", { status: 404 });
    });

    const client = new StreamableHttpClient({ url: server.url.toString() });
    await client.connect();
    const resources = new McpResourceCatalog(client);
    await expect(resources.listAllResources()).rejects.toThrow("repeated cursor");
    resources.close();
    await client.close();
  });
});
