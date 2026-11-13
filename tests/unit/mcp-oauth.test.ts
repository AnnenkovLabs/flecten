import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpHttpServerConfig } from "../../src/mcp/config";
import {
  type McpSecureStore,
  mcpOAuthConsent,
  mcpTokenKey,
  type StoredMcpToken,
  StoreTokenProvider,
} from "../../src/mcp/oauth";
import { connectMcpServers } from "../../src/mcp/session";

class MemoryStore implements McpSecureStore {
  readonly values = new Map<string, string>();

  get(key: string): string | undefined {
    return this.values.get(key);
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }
}

const dirs: string[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "liquid-mcp-oauth-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function startServer(
  fetch: (request: Request) => Response | Promise<Response>,
): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({ port: 0, fetch });
  servers.push(server);
  return server;
}

function jsonResult(id: number | string | undefined, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "content-type": "application/json", "mcp-session-id": "oauth-session" },
  });
}

function httpConfig(url: string): McpHttpServerConfig {
  return {
    url,
    headers: {},
    oauth: { scopes: ["read"], clientId: "client-1" },
    enabled: true,
    timeoutMs: 5000,
    maxTools: 64,
  };
}

describe("MCP OAuth token storage", () => {
  test("reads, refreshes and clears tokens through the secure store", async () => {
    const store = new MemoryStore();
    const config = httpConfig("https://example.com/mcp");
    const key = mcpTokenKey("docs");
    const stored: StoredMcpToken = {
      accessToken: "old",
      refreshToken: "refresh",
      expiresAt: 1000,
    };
    store.set(key, JSON.stringify(stored));

    const provider = new StoreTokenProvider({
      server: "docs",
      config,
      store,
      now: () => 2000,
      refresh: async ({ token }) => {
        expect(token.refreshToken).toBe("refresh");
        return { accessToken: "new", refreshToken: "refresh", expiresAt: 3000 };
      },
    });

    await expect(provider.getToken()).resolves.toBe("new");
    expect(JSON.parse(store.values.get(key) ?? "{}")).toMatchObject({
      accessToken: "new",
      expiresAt: 3000,
    });

    await provider.clear();
    expect(store.values.has(key)).toBe(false);
  });

  test("reports invalid stored tokens and missing refresh configuration", async () => {
    const store = new MemoryStore();
    const config = httpConfig("https://example.com/mcp");
    store.set(mcpTokenKey("docs"), "{not json");
    const invalid = new StoreTokenProvider({ server: "docs", config, store });
    await expect(invalid.getToken()).rejects.toMatchObject({ code: "invalid_token" });

    store.set(
      mcpTokenKey("docs"),
      JSON.stringify({ accessToken: "expired", refreshToken: "x", expiresAt: 1000 }),
    );
    const unavailable = new StoreTokenProvider({
      server: "docs",
      config,
      store,
      now: () => 2000,
    });
    await expect(unavailable.getToken()).rejects.toMatchObject({ code: "refresh_unavailable" });
  });

  test("derives consent metadata from the server config", () => {
    expect(mcpOAuthConsent("docs", httpConfig("https://example.com/mcp"))).toEqual({
      server: "docs",
      url: "https://example.com/mcp",
      scopes: ["read"],
      clientId: "client-1",
      tokenStorage: "secure-store",
    });
  });

  test("uses the secure store in an HTTP session and refreshes after 401", async () => {
    const authHeaders: Array<string | null> = [];
    let listCalls = 0;
    const server = startServer(async (request) => {
      authHeaders.push(request.headers.get("authorization"));
      const message = (await request.json()) as {
        id?: number;
        method: string;
        params?: unknown;
      };
      if (message.method === "initialize") {
        return jsonResult(message.id, {
          protocolVersion: "2026-07-28",
          capabilities: { tools: {} },
          serverInfo: { name: "oauth", version: "1.0.0" },
        });
      }
      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (message.method === "tools/list") {
        listCalls += 1;
        if (listCalls === 1) return new Response("unauthorized", { status: 401 });
        return jsonResult(message.id, { tools: [] });
      }
      return new Response("not found", { status: 404 });
    });

    const cwd = await tempDir();
    const store = new MemoryStore();
    store.set(
      mcpTokenKey("remote"),
      JSON.stringify({ accessToken: "old", refreshToken: "refresh" }),
    );
    const runtime = await connectMcpServers({ remote: httpConfig(server.url.toString()) }, cwd, {
      oauth: {
        store,
        refresh: () => ({ accessToken: "new", refreshToken: "refresh" }),
      },
      health: { maxAttempts: 1 },
    });

    try {
      expect(runtime.statuses[0]).toMatchObject({
        id: "remote",
        state: "ready",
        oauth: { server: "remote", scopes: ["read"], tokenStorage: "secure-store" },
      });
      expect(authHeaders).toContain("Bearer old");
      expect(authHeaders).toContain("Bearer new");
      expect(JSON.parse(store.values.get(mcpTokenKey("remote")) ?? "{}")).toMatchObject({
        accessToken: "new",
      });
    } finally {
      await runtime.close();
    }
  });

  test("surfaces secure store failures as clear server errors", async () => {
    const server = startServer(() => new Response("not reached", { status: 500 }));
    const cwd = await tempDir();
    const store: McpSecureStore = {
      get: () => {
        throw new Error("keychain locked");
      },
      set: () => undefined,
      delete: () => undefined,
    };
    const runtime = await connectMcpServers({ remote: httpConfig(server.url.toString()) }, cwd, {
      oauth: { store },
      health: { maxAttempts: 1 },
    });
    try {
      expect(runtime.statuses[0]?.state).toBe("degraded");
      expect(runtime.statuses[0]?.error).toContain("could not read token");
      expect(runtime.statuses[0]?.error).toContain("keychain locked");
    } finally {
      await runtime.close();
    }
  });
});
