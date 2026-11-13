import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { loadXConfig, scopes } from "../../src/connectors/x/config";
import { createXConnector } from "../../src/connectors/x/server";
import { hash, secret } from "../../src/connectors/x/vault";

export const Tokens = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  scope: z.string(),
});

export function fakeX(request: Request): Response {
  const url = new URL(request.url);
  if (url.pathname === "/2/oauth2/token") {
    return Response.json({
      token_type: "bearer",
      access_token: "x-private-access",
      refresh_token: "x-private-refresh",
      expires_in: 7200,
      scope: scopes.join(" "),
    });
  }
  const post = {
    id: "12345",
    text: "A short post.",
    author_id: "101",
    created_at: "2026-11-12T10:00:00Z",
    conversation_id: "12345",
    note_tweet: { text: "The complete long post.\nIncluding its second paragraph." },
    public_metrics: { like_count: 7, retweet_count: 2 },
  };
  const includes = { users: [{ id: "101", username: "writer" }] };
  if (url.pathname === "/2/tweets/search/recent") {
    return Response.json({ data: [post], includes, meta: { result_count: 1 } });
  }
  if (url.pathname === "/2/tweets/12345") return Response.json({ data: post, includes });
  return Response.json({ error: "fixture_not_found" }, { status: 404 });
}

export async function xConnector(
  upstream: (request: Request) => Response | Promise<Response> = fakeX,
) {
  const directory = await mkdtemp(join(tmpdir(), "x-chatgpt-test-"));
  let handle: (request: Request) => Promise<Response> = async () =>
    new Response(null, { status: 503 });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handle(request) });
  const config = loadXConfig({
    X_CONNECTOR_URL: server.url.origin,
    X_CLIENT_ID: "x-app",
    X_CLIENT_SECRET: "x-app-secret",
    X_CONNECTOR_CLIENT_SECRET: secret(),
    X_CONNECTOR_ENCRYPTION_KEY: secret(),
    X_CONNECTOR_STORE: join(directory, "oauth.enc"),
  });
  const requests: Request[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    expect(new URL(request.url).origin).toBe("https://api.x.com");
    expect(request.redirect).toBe("error");
    expect(request.signal).toBeDefined();
    return upstream(request);
  }) as typeof fetch;
  const connector = await createXConnector(config, fetcher);
  handle = connector.fetch;
  const token = async (parameters: Record<string, string>) =>
    fetch(`${config.baseUrl}/token`, {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        resource: `${config.baseUrl}/mcp`,
        ...parameters,
      }),
    });
  const start = async (parameters: Record<string, string> = {}) => {
    const verifier = secret();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      resource: `${config.baseUrl}/mcp`,
      state: "original-chatgpt-state",
      code_challenge: hash(verifier),
      code_challenge_method: "S256",
      scope: scopes.join(" "),
      ...parameters,
    });
    const response = await fetch(`${config.baseUrl}/authorize?${query}`, { redirect: "manual" });
    return {
      response,
      verifier,
      location: response.headers.get("location"),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  const callback = async (
    state: string,
    cookie: string,
    parameters: Record<string, string> = {},
  ) => {
    const query = new URLSearchParams({ state, code: "x-authorization-code", ...parameters });
    return fetch(`${config.baseUrl}/auth/callback?${query}`, {
      redirect: "manual",
      headers: { cookie },
    });
  };
  const login = async () => {
    const beginning = await start();
    expect(beginning.response.status).toBe(302);
    const upstreamUrl = new URL(beginning.location ?? "");
    const response = await callback(upstreamUrl.searchParams.get("state") ?? "", beginning.cookie);
    expect(response.status).toBe(302);
    const destination = new URL(response.headers.get("location") ?? "");
    const code = destination.searchParams.get("code") ?? "";
    const parameters = {
      grant_type: "authorization_code",
      code,
      code_verifier: beginning.verifier,
      redirect_uri: config.redirectUri,
    };
    const tokenResult = await token(parameters);
    expect(tokenResult.status).toBe(200);
    return { tokens: Tokens.parse(await tokenResult.json()), parameters, destination };
  };
  return {
    config,
    requests,
    connector,
    start,
    callback,
    token,
    login,
    restart: async () => {
      await connector.close();
      const reopened = await createXConnector(config, fetcher);
      handle = reopened.fetch;
      return reopened;
    },
    close: async () => {
      server.stop(true);
      await connector.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
