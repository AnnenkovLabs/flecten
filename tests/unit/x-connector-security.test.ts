import { afterEach, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { loadXConfig } from "../../src/connectors/x/config";
import { XPosts } from "../../src/connectors/x/posts";
import { OAuthVault, secret } from "../../src/connectors/x/vault";
import { fakeX, xConnector } from "../helpers/x-connector";

const fixtures: Awaited<ReturnType<typeof xConnector>>[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

async function fixture(upstream?: Parameters<typeof xConnector>[0]) {
  const app = await xConnector(upstream);
  fixtures.push(app);
  return app;
}

test("OAuth rejects unknown clients, redirect changes, wrong resources, write scopes, and PKCE downgrade", async () => {
  const app = await fixture();
  for (const parameters of [
    { client_id: "attacker" },
    { redirect_uri: "https://attacker.example/callback" },
    { resource: "https://attacker.example/mcp" },
    { scope: "tweet.read users.read offline.access tweet.write" },
    { code_challenge_method: "plain" },
    { code_challenge: "" },
    { state: "" },
  ]) {
    const { response } = await app.start(parameters);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  }
  expect(app.requests).toHaveLength(0);
  const valid = await app.start();
  const upstream = new URL(valid.location ?? "");
  const state = upstream.searchParams.get("state") ?? "";
  expect((await app.callback(state, "")).status).toBe(400);
  expect((await app.callback(secret(), valid.cookie)).status).toBe(400);
  const refused = await app.callback(state, valid.cookie, { error: "access_denied" });
  expect(refused.status).toBe(302);
  expect(new URL(refused.headers.get("location") ?? "").searchParams.get("error")).toBe(
    "access_denied",
  );
  expect((await app.callback(state, valid.cookie)).status).toBe(400);
  expect(app.requests).toHaveLength(0);
});

test("authorization codes require the correct client, redirect and PKCE verifier and cannot be reused", async () => {
  const app = await fixture();
  const start = await app.start();
  const state = new URL(start.location ?? "").searchParams.get("state") ?? "";
  const callback = await app.callback(state, start.cookie);
  expect((await app.callback(state, start.cookie)).status).toBe(400);
  const code = new URL(callback.headers.get("location") ?? "").searchParams.get("code") ?? "";
  const parameters = {
    grant_type: "authorization_code",
    code,
    code_verifier: start.verifier,
    redirect_uri: app.config.redirectUri,
  };
  expect((await app.token({ ...parameters, client_secret: "wrong" })).status).toBe(401);
  expect((await app.token({ ...parameters, code_verifier: secret() })).status).toBe(400);
  expect(
    (await app.token({ ...parameters, redirect_uri: "https://attacker.example/callback" })).status,
  ).toBe(400);
  expect((await app.token({ ...parameters, resource: "https://other.example/mcp" })).status).toBe(
    400,
  );
  expect((await app.token(parameters)).status).toBe(200);
  expect((await app.token(parameters)).status).toBe(400);
});

test("token endpoint supports Basic authentication and refuses duplicated or unbounded form parameters", async () => {
  const app = await fixture();
  const { tokens } = await app.login();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    resource: `${app.config.baseUrl}/mcp`,
  });
  const response = await fetch(`${app.config.baseUrl}/token`, {
    method: "POST",
    body,
    headers: {
      authorization: `Basic ${Buffer.from(`${app.config.clientId}:${app.config.clientSecret}`).toString("base64")}`,
    },
  });
  expect(response.status).toBe(200);
  body.append("resource", "https://other.example/mcp");
  expect((await fetch(`${app.config.baseUrl}/token`, { method: "POST", body })).status).toBe(400);
  expect(
    (
      await fetch(`${app.config.baseUrl}/token`, {
        method: "POST",
        body: "x".repeat(17_000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      })
    ).status,
  ).toBe(400);
});

test("expired authorization state and MCP access tokens fail closed while refresh remains possible", async () => {
  const app = await fixture();
  const { tokens } = await app.login();
  const vault = await OAuthVault.open(app.config.storePath, app.config.encryptionKey);
  await vault.update((state) => {
    for (const session of Object.values(state.sessions)) session.grant.expiresAt = Date.now() - 1;
  });
  const reopened = await app.restart();
  try {
    expect(
      (
        await fetch(`${app.config.baseUrl}/mcp`, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (await app.token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }))
        .status,
    ).toBe(200);
  } finally {
    await reopened.close();
  }
  const pending = await fixture();
  const start = await pending.start();
  const stored = await OAuthVault.open(pending.config.storePath, pending.config.encryptionKey);
  await stored.update((state) => {
    for (const entry of Object.values(state.pending)) entry.expiresAt = Date.now() - 1;
  });
  const refreshed = await pending.restart();
  try {
    expect(
      (
        await pending.callback(
          new URL(start.location ?? "").searchParams.get("state") ?? "",
          start.cookie,
        )
      ).status,
    ).toBe(400);
  } finally {
    await refreshed.close();
  }
});

test("X tokens without offline access or required scopes never create a ChatGPT link", async () => {
  const app = await fixture((request) =>
    new URL(request.url).pathname === "/2/oauth2/token"
      ? Response.json({
          token_type: "bearer",
          access_token: "private-credential",
          expires_in: 7200,
          scope: "tweet.read",
        })
      : fakeX(request),
  );
  const start = await app.start();
  const response = await app.callback(
    new URL(start.location ?? "").searchParams.get("state") ?? "",
    start.cookie,
  );
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("private-credential");
});

test("host and Origin guards reject unrelated browser requests and upstream bearer tokens cannot access MCP", async () => {
  const app = await fixture();
  expect(
    (await app.connector.fetch(new Request("https://attacker.example/authorize"))).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${app.config.baseUrl}/authorize`, {
        headers: { origin: "https://attacker.example" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${app.config.baseUrl}/mcp`, {
        headers: { authorization: "Bearer x-private-access" },
      })
    ).status,
  ).toBe(401);
});

test("post URLs cannot redirect the connector to arbitrary network destinations; empty results stay empty", async () => {
  const app = await fixture((request) =>
    new URL(request.url).pathname === "/2/tweets/search/recent"
      ? Response.json({ meta: { result_count: 0 } })
      : fakeX(request),
  );
  const posts = new XPosts("private-token", (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    return fakeX(new Request(input, init));
  }) as typeof fetch);
  for (const id of [
    "https://attacker.example/writer/status/12345",
    "http://127.0.0.1/status/12345",
    "https://x.com@attacker.example/writer/status/12345",
    "12345/../../users/me",
    "https://x.com/writer/status/12345/extra",
  ]) {
    await expect(posts.fetch(id, new AbortController().signal)).rejects.toThrow();
  }
  await app.login();
  const empty = new XPosts(
    "private-token",
    Object.assign(async () => Response.json({ meta: { result_count: 0 } }), {
      preconnect: fetch.preconnect,
    }),
  );
  expect(await empty.search("no results", new AbortController().signal)).toEqual({ results: [] });
});

test("vault rejects tampering and incorrect keys and configuration rejects insecure or incomplete settings", async () => {
  const app = await fixture();
  await app.login();
  await expect(
    OAuthVault.open(app.config.storePath, Buffer.from(secret(), "base64url")),
  ).rejects.toThrow("Cannot decrypt");
  const bytes = await readFile(app.config.storePath);
  bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;
  await writeFile(app.config.storePath, bytes);
  await expect(OAuthVault.open(app.config.storePath, app.config.encryptionKey)).rejects.toThrow(
    "Cannot decrypt",
  );
  expect(() => loadXConfig({})).toThrow("X_CLIENT_ID");
  const environment = {
    X_CONNECTOR_URL: "http://public.example",
    X_CLIENT_ID: "id",
    X_CLIENT_SECRET: "secret",
    X_CONNECTOR_CLIENT_SECRET: secret(),
    X_CONNECTOR_ENCRYPTION_KEY: secret(),
  };
  expect(() => loadXConfig(environment)).toThrow("HTTPS");
  expect(() =>
    loadXConfig({ ...environment, X_CONNECTOR_URL: "https://connector.example/path" }),
  ).toThrow("without a path");
});
