import { afterEach, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { hash } from "../../src/connectors/x/vault";
import { fakeX, Tokens, xConnector } from "../helpers/x-connector";

const fixtures: Awaited<ReturnType<typeof xConnector>>[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

async function fixture(upstream?: Parameters<typeof xConnector>[0]) {
  const instance = await xConnector(upstream);
  fixtures.push(instance);
  return instance;
}

async function mcp(baseUrl: string, accessToken: string, legacy = false) {
  const client = new Client(
    { name: "x-connector-test", version: "1.0.0" },
    {
      versionNegotiation: { mode: legacy ? "legacy" : "auto" },
    },
  );
  clients.push(client);
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
  return client;
}

test("ChatGPT OAuth login leads to schema-validated search and full post retrieval over real HTTP MCP", async () => {
  const app = await fixture();
  const unauthenticated = await fetch(`${app.config.baseUrl}/mcp`);
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
  const metadata = await fetch(`${app.config.baseUrl}/.well-known/oauth-authorization-server`);
  expect(await metadata.json()).toMatchObject({
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
  });
  const start = await app.start();
  expect(start.response.status).toBe(302);
  const upstream = new URL(start.location ?? "");
  expect(upstream.origin + upstream.pathname).toBe("https://x.com/i/oauth2/authorize");
  expect(upstream.searchParams.get("scope")).toBe("tweet.read users.read offline.access");
  expect(upstream.searchParams.get("redirect_uri")).toBe(`${app.config.baseUrl}/auth/callback`);
  expect(upstream.searchParams.get("code_challenge_method")).toBe("S256");
  expect(start.response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
  const callback = await app.callback(upstream.searchParams.get("state") ?? "", start.cookie);
  expect(callback.status).toBe(302);
  const destination = new URL(callback.headers.get("location") ?? "");
  expect(destination.origin + destination.pathname).toBe(app.config.redirectUri);
  expect(destination.searchParams.get("state")).toBe("original-chatgpt-state");
  expect(destination.searchParams.get("iss")).toBe(app.config.baseUrl);
  const upstreamRequest = app.requests[0];
  expect(upstreamRequest?.headers.get("authorization")).toStartWith("Basic ");
  const exchanged = new URLSearchParams(await upstreamRequest?.text());
  expect(hash(exchanged.get("code_verifier") ?? "")).toBe(
    upstream.searchParams.get("code_challenge") ?? "",
  );
  const response = await app.token({
    grant_type: "authorization_code",
    code: destination.searchParams.get("code") ?? "",
    code_verifier: start.verifier,
    redirect_uri: app.config.redirectUri,
  });
  expect(response.status).toBe(200);
  const tokens = Tokens.parse(await response.json());
  expect(tokens.access_token).not.toBe("x-private-access");
  expect(tokens.refresh_token).not.toBe("x-private-refresh");

  const client = await mcp(app.config.baseUrl, tokens.access_token);
  const listing = await client.listTools();
  expect(listing.tools.map((tool) => tool.name).sort()).toEqual(["fetch", "search"]);
  expect(listing.tools.every((tool) => tool.outputSchema && tool.annotations?.readOnlyHint)).toBe(
    true,
  );
  const search = await client.callTool({
    name: "search",
    arguments: { query: "from:writer lang:en" },
  });
  expect(search.structuredContent).toMatchObject({
    results: [{ id: "12345", url: "https://x.com/writer/status/12345" }],
  });
  expect(search.content).toEqual([
    { type: "text", text: JSON.stringify(search.structuredContent) },
  ]);
  const post = await client.callTool({
    name: "fetch",
    arguments: { id: "https://twitter.com/writer/status/12345?s=20" },
  });
  expect(post.structuredContent).toMatchObject({
    id: "12345",
    text: "The complete long post.\nIncluding its second paragraph.",
    metadata: { author: "writer", public_metrics: { like_count: 7 } },
  });
  const searchRequest = app.requests.find(
    (request) => new URL(request.url).pathname === "/2/tweets/search/recent",
  );
  expect(new URL(searchRequest?.url ?? "").searchParams.get("query")).toBe("from:writer lang:en");
  expect(searchRequest?.headers.get("authorization")).toBe("Bearer x-private-access");

  const legacy = await mcp(app.config.baseUrl, tokens.access_token, true);
  expect((await legacy.listTools()).tools).toHaveLength(2);
  expect((await legacy.callTool({ name: "fetch", arguments: { id: "12345" } })).isError).not.toBe(
    true,
  );
  const encrypted = await readFile(app.config.storePath);
  for (const sensitive of [
    "x-private-access",
    "x-private-refresh",
    tokens.access_token,
    tokens.refresh_token,
  ]) {
    expect(encrypted.includes(Buffer.from(sensitive))).toBe(false);
  }
  if (process.platform !== "win32")
    expect((await stat(app.config.storePath)).mode & 0o777).toBe(0o600);
});

test("links survive restart, refresh tokens rotate once, and revocation blocks subsequent MCP calls", async () => {
  let refreshes = 0;
  const app = await fixture(async (request) => {
    if (new URL(request.url).pathname === "/2/oauth2/token") {
      const form = new URLSearchParams(await request.clone().text());
      if (form.get("grant_type") === "refresh_token") {
        refreshes++;
        expect(form.get("refresh_token")).toBe("x-private-refresh");
        return Response.json({
          token_type: "bearer",
          access_token: "x-refreshed",
          refresh_token: "x-rotated",
          expires_in: 7200,
          scope: "tweet.read users.read offline.access",
        });
      }
    }
    return fakeX(request);
  });
  const { tokens, parameters } = await app.login();
  expect((await app.token(parameters)).status).toBe(400);
  const reopened = await app.restart();
  try {
    const original = await mcp(app.config.baseUrl, tokens.access_token);
    expect((await original.listTools()).tools).toHaveLength(2);
    const responses = await Promise.all(
      [1, 2].map(() =>
        app.token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(refreshes).toBe(1);
    const success = responses.find((response) => response.ok);
    const refreshed = Tokens.parse(await success?.json());
    const invalidated = await fetch(`${app.config.baseUrl}/mcp`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(invalidated.status).toBe(401);
    const client = await mcp(app.config.baseUrl, refreshed.access_token);
    await client.callTool({ name: "search", arguments: { query: "test" } });
    expect(app.requests.at(-1)?.headers.get("authorization")).toBe("Bearer x-refreshed");
    const revoke = await fetch(`${app.config.baseUrl}/revoke`, {
      method: "POST",
      body: new URLSearchParams({
        client_id: app.config.clientId,
        client_secret: app.config.clientSecret,
        token: refreshed.refresh_token,
      }),
    });
    expect(revoke.status).toBe(200);
    expect(
      (
        await fetch(`${app.config.baseUrl}/mcp`, {
          headers: { authorization: `Bearer ${refreshed.access_token}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (await app.token({ grant_type: "refresh_token", refresh_token: refreshed.refresh_token }))
        .status,
    ).toBe(400);
  } finally {
    await reopened.close();
  }
});

test("different OAuth links use different X account tokens on every MCP request", async () => {
  let loginNumber = 0;
  const seen: string[] = [];
  const app = await fixture((request) => {
    if (new URL(request.url).pathname === "/2/oauth2/token") {
      loginNumber++;
      return Response.json({
        token_type: "bearer",
        access_token: `account-${loginNumber}`,
        refresh_token: `refresh-${loginNumber}`,
        expires_in: 7200,
        scope: "tweet.read users.read offline.access",
      });
    }
    seen.push(request.headers.get("authorization") ?? "");
    return fakeX(request);
  });
  const first = await app.login();
  const second = await app.login();
  const a = await mcp(app.config.baseUrl, first.tokens.access_token);
  const b = await mcp(app.config.baseUrl, second.tokens.access_token);
  await a.callTool({ name: "search", arguments: { query: "one" } });
  await b.callTool({ name: "search", arguments: { query: "two" } });
  await a.callTool({ name: "fetch", arguments: { id: "12345" } });
  expect(seen).toEqual(["Bearer account-1", "Bearer account-2", "Bearer account-1"]);
});

test("X failures and malformed responses become readable MCP errors without credential leakage", async () => {
  let status = 429;
  const app = await fixture((request) => {
    if (new URL(request.url).pathname === "/2/oauth2/token") return fakeX(request);
    if (status === 200) return Response.json({ data: [{ id: "not-an-id", text: "bad" }] });
    return Response.json({ detail: "x-private-access secret internal diagnostic" }, { status });
  });
  const { tokens } = await app.login();
  const client = await mcp(app.config.baseUrl, tokens.access_token);
  for (const code of [429, 401, 402, 403, 500, 200]) {
    status = code;
    const result = await client.callTool({ name: "search", arguments: { query: "test" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("x-private-access");
    if (code === 429) expect(JSON.stringify(result)).toContain("rate limit");
  }
});
