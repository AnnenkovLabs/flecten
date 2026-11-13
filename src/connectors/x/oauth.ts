import { z } from "zod";
import { scopes } from "./config";
import { authenticateClient, json, readForm, tokenResponse } from "./oauth-tokens";
import type { XGrant } from "./state";
import { hash, matches, type OAuthVault, secret } from "./vault";
import { OAuthFailure, type XOAuth } from "./x-oauth";

const Authorization = z.object({
  response_type: z.literal("code"),
  client_id: z.string(),
  redirect_uri: z.string(),
  resource: z.string(),
  code_challenge: z.string().length(43),
  code_challenge_method: z.literal("S256"),
  state: z.string().min(1).max(2048),
  scope: z.string().optional(),
});

export class XAuthorization {
  constructor(
    readonly vault: OAuthVault,
    readonly x: XOAuth,
  ) {}

  async route(request: Request): Promise<Response | undefined> {
    const { pathname, searchParams } = new URL(request.url);
    const base = this.x.config.baseUrl;
    if (request.method === "GET" && pathname === "/.well-known/oauth-authorization-server") {
      return json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        revocation_endpoint: `${base}/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        scopes_supported: scopes,
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (
      request.method === "GET" &&
      [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ].includes(pathname)
    ) {
      return json({
        resource: `${base}/mcp`,
        authorization_servers: [base],
        scopes_supported: scopes,
        bearer_methods_supported: ["header"],
      });
    }
    if (request.method === "GET" && pathname === "/authorize") return this.#authorize(searchParams);
    if (request.method === "GET" && pathname === "/auth/callback")
      return this.#callback(request, searchParams);
    if (request.method === "POST" && pathname === "/token")
      return tokenResponse(request, this.vault, this.x);
    if (request.method === "POST" && pathname === "/revoke") {
      const form = await readForm(request);
      authenticateClient(request, form, this.x);
      const value = form.get("token");
      if (!value) throw new OAuthFailure("invalid_request", "Token is required.");
      await this.vault.update((state) => {
        for (const [id, session] of Object.entries(state.sessions)) {
          if (
            matches(hash(value), session.accessTokenHash) ||
            matches(hash(value), session.refreshTokenHash)
          )
            delete state.sessions[id];
        }
      });
      return json({});
    }
    return undefined;
  }

  challenge(): Response {
    return json(
      { error: "invalid_token", error_description: "Connect your X account using OAuth." },
      401,
      {
        "www-authenticate": `Bearer resource_metadata="${this.x.config.baseUrl}/.well-known/oauth-protected-resource/mcp", scope="${scopes.join(" ")}"`,
      },
    );
  }

  async authenticate(request: Request): Promise<XGrant | undefined> {
    const [scheme, token, extra] = (request.headers.get("authorization") ?? "").split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token || extra) return undefined;
    return this.vault.read((state) => {
      const session = Object.values(state.sessions).find((item) =>
        matches(hash(token), item.accessTokenHash),
      );
      if (!session || session.expiresAt <= Date.now() || session.grant.expiresAt <= Date.now())
        return undefined;
      return structuredClone(session.grant);
    });
  }

  async #authorize(parameters: URLSearchParams): Promise<Response> {
    for (const key of parameters.keys()) {
      if (parameters.getAll(key).length !== 1)
        throw new OAuthFailure("invalid_request", "Duplicate authorization parameter.");
    }
    const parsed = Authorization.safeParse(Object.fromEntries(parameters));
    if (!parsed.success)
      throw new OAuthFailure(
        "invalid_request",
        "Authorization requires state, resource, and PKCE S256.",
      );
    const input = parsed.data;
    const config = this.x.config;
    if (input.client_id !== config.clientId || input.redirect_uri !== config.redirectUri) {
      throw new OAuthFailure(
        "invalid_request",
        "Client or redirect URI does not match the configured ChatGPT connection.",
      );
    }
    if (input.resource !== `${config.baseUrl}/mcp`)
      throw new OAuthFailure("invalid_target", "Unexpected OAuth resource.");
    if (
      input.scope !== undefined &&
      (input.scope.split(" ").length !== scopes.length ||
        !scopes.every((scope) => input.scope?.split(" ").includes(scope)))
    ) {
      throw new OAuthFailure(
        "invalid_scope",
        "Only tweet.read, users.read, and offline.access are supported.",
      );
    }
    const state = secret();
    const verifier = secret();
    const binding = secret();
    await this.vault.update((stored) => {
      stored.pending[state] = {
        clientState: input.state,
        codeChallenge: input.code_challenge,
        upstreamVerifier: verifier,
        browserBinding: hash(binding),
        expiresAt: Date.now() + 10 * 60_000,
      };
    });
    const redirect = new URL("https://x.com/i/oauth2/authorize");
    redirect.search = new URLSearchParams({
      response_type: "code",
      client_id: config.xClientId,
      redirect_uri: `${config.baseUrl}/auth/callback`,
      scope: scopes.join(" "),
      state,
      code_challenge: hash(verifier),
      code_challenge_method: "S256",
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        location: redirect.toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "set-cookie": this.#cookie(state, binding, 600),
      },
    });
  }

  async #callback(request: Request, parameters: URLSearchParams): Promise<Response> {
    const stateId = parameters.get("state") ?? "";
    if (parameters.getAll("state").length !== 1 || stateId.length !== 43)
      throw new OAuthFailure("invalid_request", "Invalid OAuth state.");
    const cookieName = `x_oauth_${stateId}`;
    const binding = request.headers
      .get("cookie")
      ?.split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    return this.vault.update(async (stored) => {
      const pending = stored.pending[stateId];
      if (!pending || !binding || !matches(hash(binding), pending.browserBinding))
        throw new OAuthFailure(
          "invalid_request",
          "OAuth state or browser binding expired. Start again from ChatGPT.",
        );
      const redirect = new URL(this.x.config.redirectUri);
      redirect.searchParams.set("state", pending.clientState);
      redirect.searchParams.set("iss", this.x.config.baseUrl);
      if (parameters.has("error")) {
        redirect.searchParams.set("error", "access_denied");
      } else {
        const code = parameters.get("code");
        if (!code || parameters.getAll("code").length !== 1)
          throw new OAuthFailure("invalid_request", "Missing X authorization code.");
        const grant = await this.x.exchange(
          {
            grant_type: "authorization_code",
            code,
            redirect_uri: `${this.x.config.baseUrl}/auth/callback`,
            code_verifier: pending.upstreamVerifier,
          },
          request.signal,
        );
        const authorizationCode = secret();
        stored.codes[hash(authorizationCode)] = {
          codeChallenge: pending.codeChallenge,
          grant,
          expiresAt: Date.now() + 60_000,
        };
        redirect.searchParams.set("code", authorizationCode);
      }
      delete stored.pending[stateId];
      return new Response(null, {
        status: 302,
        headers: {
          location: redirect.toString(),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "set-cookie": this.#cookie(stateId, "", 0),
        },
      });
    });
  }

  #cookie(state: string, value: string, maxAge: number): string {
    const secure = this.x.config.baseUrl.startsWith("https:") ? "; Secure" : "";
    return `x_oauth_${state}=${value}; Path=/auth/callback; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }
}
