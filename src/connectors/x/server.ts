import { createMcpHandler } from "@modelcontextprotocol/server";
import { loadXConfig, type XConfig } from "./config";
import { createXMcpServer } from "./mcp";
import { XAuthorization } from "./oauth";
import { json } from "./oauth-tokens";
import { OAuthVault } from "./vault";
import { OAuthFailure, XOAuth } from "./x-oauth";

export async function createXConnector(config: XConfig, fetcher: typeof fetch = fetch) {
  const vault = await OAuthVault.open(config.storePath, config.encryptionKey);
  const authorization = new XAuthorization(vault, new XOAuth(config, fetcher));
  const mcp = createMcpHandler(
    async ({ requestInfo }) => {
      const grant = requestInfo ? await authorization.authenticate(requestInfo) : undefined;
      if (!grant) throw new OAuthFailure("invalid_token", "Connect X again.", 401);
      return createXMcpServer(grant.accessToken, fetcher);
    },
    { maxRequestBodySize: 65_536 },
  );

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.host !== new URL(config.baseUrl).host) return json({ error: "invalid_host" }, 403);
      const origin = request.headers.get("origin");
      if (origin && origin !== config.baseUrl) return json({ error: "invalid_origin" }, 403);
      try {
        const oauthResponse = await authorization.route(request);
        if (oauthResponse) return oauthResponse;
        if (url.pathname === "/healthz" && request.method === "GET") return json({ status: "ok" });
        if (url.pathname !== "/mcp") return json({ error: "not_found" }, 404);
        if (!(await authorization.authenticate(request))) return authorization.challenge();
        const response = await mcp.fetch(request);
        response.headers.set("cache-control", "no-store");
        return response;
      } catch (error) {
        if (error instanceof OAuthFailure) {
          return json(
            { error: error.error, error_description: error.message },
            error.status,
            error.error === "invalid_client"
              ? { "www-authenticate": 'Basic realm="X connector"' }
              : {},
          );
        }
        return json(
          {
            error: "server_error",
            error_description:
              "The connector could not complete the request. Check its configuration and storage.",
          },
          500,
        );
      }
    },
    close: () => mcp.close(),
  };
}

if (import.meta.main) {
  try {
    const config = loadXConfig();
    const connector = await createXConnector(config);
    const server = Bun.serve({
      hostname: config.hostname,
      port: config.port,
      fetch: connector.fetch,
      maxRequestBodySize: 65_536,
      idleTimeout: 30,
    });
    process.stderr.write(
      `X connector listening on ${config.hostname}:${server.port}; MCP URL: ${config.baseUrl}/mcp\n`,
    );
    const stop = async () => {
      server.stop(true);
      await connector.close();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "X connector startup failed."}\n`,
    );
    process.exitCode = 1;
  }
}
