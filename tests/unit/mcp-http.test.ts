import { afterEach, describe, expect, test } from "bun:test";
import {
  isHttpServerConfig,
  McpHttpServerConfigSchema,
  McpServerConfigSchema,
  McpStdioServerConfigSchema,
  parseMcpServerConfig,
} from "../../src/mcp/config";
import { McpHealth } from "../../src/mcp/health";
import {
  DEFAULT_MCP_PROTOCOL_VERSION,
  McpTimeoutError,
  StreamableHttpClient,
} from "../../src/mcp/http";
import { InMemoryTokenProvider } from "../../src/mcp/oauth";

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

function jsonResult(
  id: number | string | undefined,
  result: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "content-type": "application/json", ...headers },
  });
}

function initializeResult(message: RpcRequest, sessionId: string): Response {
  return jsonResult(
    message.id,
    {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "fake", version: "1.0.0" },
    },
    { "mcp-session-id": sessionId },
  );
}

function sse(messages: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
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

async function rpc(request: Request): Promise<RpcRequest> {
  return (await request.json()) as RpcRequest;
}

async function waitFor(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("condition was not met in time");
    await Bun.sleep(5);
  }
}

describe("MCP Streamable HTTP", () => {
  test("initializes over JSON and echoes session and protocol version", async () => {
    let initParams: Record<string, unknown> | undefined;
    let initialized = 0;
    const seen: Headers[] = [];
    const server = startServer(async (request) => {
      seen.push(request.headers);
      const message = await rpc(request);
      if (message.method === "initialize") {
        initParams = message.params;
        return jsonResult(
          message.id,
          {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "fake", version: "1.0.0" },
            instructions: "Use echo.",
          },
          { "mcp-session-id": "session-1" },
        );
      }
      if (message.method === "notifications/initialized") {
        initialized += 1;
        return new Response(null, { status: 202 });
      }
      if (message.method === "tools/list")
        return jsonResult(message.id, { tools: [{ name: "echo" }] });
      return new Response("not found", { status: 404 });
    });

    const client = new StreamableHttpClient({
      url: server.url.toString(),
      protocolVersion: "2026-07-28",
      retry: { attempts: 1 },
    });

    const negotiation = await client.connect();
    expect(negotiation).toMatchObject({
      sessionId: "session-1",
      protocolVersion: "2025-06-18",
      instructions: "Use echo.",
    });
    expect(initialized).toBe(1);
    expect(initParams).toMatchObject({
      protocolVersion: "2026-07-28",
      clientInfo: { name: "flecten" },
    });

    const result = await client.request<{ tools: Array<{ name: string }> }>("tools/list");
    expect(result.tools[0]?.name).toBe("echo");

    const headers = seen.at(-1);
    expect(headers?.get("accept")).toBe("application/json, text/event-stream");
    expect(headers?.get("mcp-session-id")).toBe("session-1");
    expect(headers?.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(client.connected).toBe(true);
    expect(DEFAULT_MCP_PROTOCOL_VERSION).toBe("2026-07-28");
    await client.close();
  });

  test("parses SSE responses and dispatches notifications", async () => {
    const server = startServer(async (request) => {
      const message = await rpc(request);
      if (message.method === "initialize") return initializeResult(message, "session-sse");
      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (message.method === "tools/list") {
        return sse([
          { jsonrpc: "2.0", method: "notifications/tools/list_changed" },
          { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "sse-tool" }] } },
        ]);
      }
      return new Response("not found", { status: 404 });
    });

    const client = new StreamableHttpClient({ url: server.url.toString() });
    const notifications: string[] = [];
    client.onNotification((notification) => notifications.push(notification.method));
    await client.connect();
    const result = await client.request<{ tools: Array<{ name: string }> }>("tools/list");
    expect(result.tools[0]?.name).toBe("sse-tool");
    expect(notifications).toEqual(["notifications/tools/list_changed"]);
    await client.close();
  });

  test("refreshes a token once after a 401 response", async () => {
    const tokens: Array<string | null> = [];
    const server = startServer(async (request) => {
      const message = await rpc(request);
      if (message.method === "initialize") return initializeResult(message, "session-auth");
      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (message.method === "tools/list") {
        tokens.push(request.headers.get("authorization"));
        if (tokens.length === 1) return new Response("unauthorized", { status: 401 });
        return jsonResult(message.id, { tools: [] });
      }
      return new Response("not found", { status: 404 });
    });

    const provider = new InMemoryTokenProvider({ token: "old", refresh: () => "new" });
    const client = new StreamableHttpClient({
      url: server.url.toString(),
      tokenProvider: provider,
    });
    await client.connect();
    const result = await client.request<{ tools: unknown[] }>("tools/list");
    expect(result.tools).toEqual([]);
    expect(tokens).toEqual(["Bearer old", "Bearer new"]);
    expect(provider.refreshCount).toBe(1);
    await client.close();
  });

  test("times out a request and aborts an in-flight request", async () => {
    const server = startServer(async (request) => {
      const message = await rpc(request);
      if (message.method === "initialize") return initializeResult(message, "session-timeout");
      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (message.method === "tools/list") {
        await Bun.sleep(200);
        return jsonResult(message.id, { tools: [] });
      }
      return new Response("not found", { status: 404 });
    });

    const client = new StreamableHttpClient({
      url: server.url.toString(),
      timeoutMs: 30,
      retry: { attempts: 1 },
    });
    await client.connect();
    await expect(client.request("tools/list")).rejects.toBeInstanceOf(McpTimeoutError);

    const controller = new AbortController();
    const pending = client.request("tools/list", undefined, {
      signal: controller.signal,
      timeoutMs: 1000,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await client.close();
  });

  test("reconnects with backoff through a degraded state", async () => {
    let initializeAttempts = 0;
    const server = startServer(async (request) => {
      const message = await rpc(request);
      if (message.method === "initialize") {
        initializeAttempts += 1;
        if (initializeAttempts === 1) return new Response("warming up", { status: 503 });
        return initializeResult(message, "session-reconnected");
      }
      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (message.method === "tools/list") return jsonResult(message.id, { tools: [] });
      return new Response("not found", { status: 404 });
    });

    const client = new StreamableHttpClient({
      url: server.url.toString(),
      retry: { attempts: 1 },
    });
    const states: string[] = [];
    const health = new McpHealth({
      connect: async () => {
        await client.connect();
      },
      baseDelayMs: 5,
      maxDelayMs: 20,
      maxAttempts: 3,
      onChange: (snapshot) => states.push(snapshot.state),
    });

    health.start();
    await waitFor(() => health.state === "ready");
    expect(initializeAttempts).toBe(2);
    expect(states).toEqual(["connecting", "degraded", "connecting", "ready"]);
    expect(health.snapshot().counters).toEqual({
      attempts: 2,
      successes: 1,
      failures: 1,
      reconnects: 1,
    });

    const result = await client.request<{ tools: unknown[] }>("tools/list");
    expect(result.tools).toEqual([]);
    health.close();
    expect(health.snapshot()).toMatchObject({ state: "closed" });
    await client.close();
  });
});

describe("MCP config", () => {
  test("validates HTTP and stdio server shapes", () => {
    const http = McpHttpServerConfigSchema.parse({
      url: "https://example.com/mcp",
      oauth: { scopes: ["read"] },
    });
    expect(http).toMatchObject({
      headers: {},
      enabled: true,
      oauth: { scopes: ["read"] },
    });

    const stdio = McpStdioServerConfigSchema.parse({ command: "bun", args: ["server.ts"] });
    expect(stdio).toMatchObject({ args: ["server.ts"], env: {}, protocol: "auto" });

    const parsed = parseMcpServerConfig({ url: "http://127.0.0.1:3000/mcp" });
    expect(isHttpServerConfig(parsed)).toBe(true);
    expect(() => McpServerConfigSchema.parse({ url: "file:///tmp/socket" })).toThrow();
    expect(() =>
      McpServerConfigSchema.parse({ url: "http://127.0.0.1/mcp", command: "bun" }),
    ).toThrow();
    expect(() => McpServerConfigSchema.parse({})).toThrow();
  });
});
