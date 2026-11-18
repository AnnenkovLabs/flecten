# X Connector for ChatGPT

Read-only MCP connector for searching and fetching X posts through a user's own X account. On connection, ChatGPT opens the X sign-in page and requests `tweet.read`, `users.read`, and `offline.access`. Once authorized, ChatGPT can search posts and cite them by X URL.

The server runs independently of Flecten. X credentials are never exposed to ChatGPT: the connector mints its own OAuth tokens and stores X tokens encrypted on disk. Access is strictly read-only. Search returns up to 10 posts from the past 7 days; fetching by post ID or URL is not bound to that 7-day search window. Post visibility and API quotas are governed by X.

## Prerequisites

- Bun 1.4+ with repository dependencies installed (`bun install`).
- An app in the [X Developer Console](https://console.x.com/) with OAuth 2.0 enabled and API access for the required endpoints. OAuth does not bypass X pricing tiers, request billing, or rate limits.
- A stable HTTPS domain pointing a reverse proxy to local port `8787`.
- A ChatGPT account and workspace plan that allows custom MCP servers.

## 1. Configure the X App

Enable OAuth 2.0 in your X app settings using **Web App** (or another confidential client type with a Client Secret) and **Read** permissions.

Set the callback URL:

```text
https://YOUR-DOMAIN/auth/callback
```

Copy the **OAuth 2.0 Client ID** and **Client Secret** (distinct from the API Key, API Key Secret, and Bearer Token). End users authenticate through X and never enter a manual Bearer Token.

## 2. Configure and Run the Server

From the repository root:

```bash
cp connectors/x-chatgpt/.env.example connectors/x-chatgpt/.env
chmod 600 connectors/x-chatgpt/.env
```

Set `X_CONNECTOR_URL`, `X_CLIENT_ID`, and `X_CLIENT_SECRET`. The domain in `X_CONNECTOR_URL` must match the X app callback URL. Path prefixes before `/mcp` are not supported.

Generate two distinct 32-byte secrets by running this command twice:

```bash
bun -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url") + "\n")'
```

Assign the first value to `X_CONNECTOR_CLIENT_SECRET` and the second to `X_CONNECTOR_ENCRYPTION_KEY`. Keep `X_CONNECTOR_ENCRYPTION_KEY` stable across restarts: rotating it without migration invalidates existing stored connections. Back up the key separately from the encrypted store. Both `.env` and `.flecten/` are gitignored.

Start the server:

```bash
bun run connector:x
```

By default, the server listens on `127.0.0.1:8787`. Route the entire HTTPS domain to that port while preserving the original `Host` header. Example Caddy configuration:

```caddyfile
x-connector.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Verify the public endpoints:

```bash
curl https://YOUR-DOMAIN/healthz
curl https://YOUR-DOMAIN/.well-known/oauth-authorization-server
curl -i https://YOUR-DOMAIN/mcp
```

The first two requests must return `200`. Before authorization, `/mcp` returns `401` with a `WWW-Authenticate` header pointing to the OAuth metadata URL. Configure your reverse proxy to omit OAuth callback query parameters and `Authorization`/`Cookie` headers from access logs.

## 3. Connect in ChatGPT

Open **Plugins** -> **+** -> **Add custom MCP server** (or the custom MCP connector flow in your ChatGPT apps settings).

Enter the server URL:

```text
https://YOUR-DOMAIN/mcp
```

Select **OAuth** and enter the connector credentials:

| ChatGPT Field | `.env` Variable |
|---|---|
| Client ID | `X_CONNECTOR_CLIENT_ID` (defaults to `chatgpt-x`) |
| Client Secret | `X_CONNECTOR_CLIENT_SECRET` |

Copy the exact redirect URI displayed by ChatGPT into `X_CONNECTOR_REDIRECT_URI`. Because the server advertises OAuth issuer identification, the current documented URI is `https://chatgpt.com/connector_platform_oauth_redirect`; if ChatGPT displays a different URI, use the displayed value and restart the server.

Save and authorize the connector on X, then `@`-mention it in a new chat:

```text
Find recent posts from OpenAI about Codex and summarize them with links.
Read https://x.com/HANDLE/status/ID and explain the main argument.
Search posts matching from:OpenAI lang:en -is:retweet.
```

The server exposes `search(query)` and `fetch(id)`, each returning structured content, a plain-text fallback, and a canonical citation URL. Expired tokens refresh via standard OAuth refresh grants. Refresh connector metadata in ChatGPT whenever tool schemas change.

## Storage and Limits

- Authorization Code + PKCE (`S256`) runs on both legs: ChatGPT -> connector and connector -> X. Browser callbacks bind via an `HttpOnly` cookie, and both redirect URIs and MCP resource indicators are matched strictly.
- Supports a single preconfigured ChatGPT OAuth client; Dynamic Client Registration (DCR) and arbitrary third-party OAuth clients are disabled. Separate user connections maintain isolated X tokens.
- X tokens are encrypted at rest with AES-256-GCM; connector-issued access and refresh tokens are stored as SHA-256 digests. Store updates write atomically with `0600` permissions.
- Run a single server process per storage file; multi-replica deployments require a transactional database. Capacity is capped at 1,000 active connections, 1,000 pending logins, and 1,000 authorization codes.
- Pending logins expire after 10 minutes, authorization codes after 60 seconds, and idle connections after 30 days. Connector refresh tokens rotate on every refresh.
- `/revoke` revokes the connector session; revoke X app permissions directly in your X account's connected-apps settings.
- `search` returns at most 10 results with no automatic pagination. `fetch` retrieves a single post (including full long-form text when X returns `note_tweet`) without expanding threads or downloading media.
- Upstream `401` requires reconnecting the X account; `402`/`403` indicates insufficient X API tier access; `429` indicates X rate/quota exhaustion. Paid upstream requests are never retried automatically.

## Verification

```bash
bun test tests/integration/x-connector.test.ts tests/unit/x-connector-security.test.ts
```

Tests boot the real HTTP MCP server and drive it with the official MCP SDK client against local OAuth and X API fixtures, covering both PKCE flows, single-use authorization codes, token rotation and revocation, multi-account isolation, encrypted persistence, search, and post lookup. Live X sign-in and ChatGPT integration require a configured X app, public HTTPS domain, and interactive user consent.

## References

- [OpenAI: MCP search/fetch and citations](https://developers.openai.com/api/docs/mcp)
- [OpenAI: OAuth for MCP](https://developers.openai.com/plugins/build/auth)
- [OpenAI: Connect to ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)
- [X: OAuth 2.0 Authorization Code Flow with PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [X: Search recent posts](https://docs.x.com/x-api/posts/search/quickstart/recent-search)
- [X: Post lookup](https://docs.x.com/x-api/posts/lookup/quickstart)
