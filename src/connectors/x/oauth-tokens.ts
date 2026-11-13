import { z } from "zod";
import { scopes } from "./config";
import type { OAuthState, XGrant } from "./state";
import { hash, matches, type OAuthVault, secret } from "./vault";
import { OAuthFailure, type XOAuth } from "./x-oauth";

const Form = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  resource: z.string(),
  code: z.string().min(1).optional(),
  code_verifier: z.string().min(43).max(128).optional(),
  redirect_uri: z.string().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const result = Response.json(body, { status, headers });
  result.headers.set("cache-control", "no-store");
  result.headers.set("pragma", "no-cache");
  result.headers.set("referrer-policy", "no-referrer");
  return result;
}

export async function readForm(request: Request): Promise<URLSearchParams> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/x-www-form-urlencoded"
  ) {
    throw new OAuthFailure("invalid_request", "Expected form-encoded OAuth parameters.");
  }
  const text = await request.text();
  if (text.length > 16_384)
    throw new OAuthFailure("invalid_request", "OAuth request is too large.");
  const form = new URLSearchParams(text);
  for (const key of form.keys()) {
    if (form.getAll(key).length !== 1)
      throw new OAuthFailure("invalid_request", "Duplicate OAuth parameter.");
  }
  return form;
}

export function authenticateClient(request: Request, form: URLSearchParams, x: XOAuth): void {
  let clientId = form.get("client_id") ?? "";
  let clientSecret = form.get("client_secret") ?? "";
  const authorization = request.headers.get("authorization");
  if (authorization) {
    if (clientId || clientSecret)
      throw new OAuthFailure("invalid_request", "Use one client authentication method.");
    const [scheme, value, extra] = authorization.split(" ");
    if (scheme?.toLowerCase() !== "basic" || !value || extra)
      throw new OAuthFailure("invalid_client", "Invalid client authentication.", 401);
    try {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon < 0) throw new Error("Missing separator");
      clientId = decodeURIComponent(decoded.slice(0, colon));
      clientSecret = decodeURIComponent(decoded.slice(colon + 1));
    } catch {
      throw new OAuthFailure("invalid_client", "Invalid client authentication.", 401);
    }
  }
  if (!matches(clientId, x.config.clientId) || !matches(clientSecret, x.config.clientSecret)) {
    throw new OAuthFailure("invalid_client", "Invalid client authentication.", 401);
  }
}

export function issueTokens(state: OAuthState, grant: XGrant, previousSessionId?: string) {
  if (previousSessionId) delete state.sessions[previousSessionId];
  const accessToken = secret();
  const refreshToken = secret();
  // ponytail: inactive links expire after 30 days; add a configurable retention policy if needed.
  state.sessions[secret()] = {
    grant,
    accessTokenHash: hash(accessToken),
    refreshTokenHash: hash(refreshToken),
    expiresAt: Date.now() + 30 * 24 * 60 * 60_000,
  };
  return json({
    token_type: "Bearer",
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Math.max(1, Math.floor((grant.expiresAt - Date.now()) / 1000)),
    scope: scopes.join(" "),
  });
}

export async function tokenResponse(
  request: Request,
  vault: OAuthVault,
  x: XOAuth,
): Promise<Response> {
  const form = await readForm(request);
  authenticateClient(request, form, x);
  const parsed = Form.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    throw new OAuthFailure("invalid_request", "Missing or invalid OAuth parameters.");
  const input = parsed.data;
  if (input.resource !== `${x.config.baseUrl}/mcp`)
    throw new OAuthFailure("invalid_target", "Unexpected OAuth resource.");
  if (
    input.scope !== undefined &&
    (input.scope.split(" ").length !== scopes.length ||
      !scopes.every((scope) => input.scope?.split(" ").includes(scope)))
  ) {
    throw new OAuthFailure(
      "invalid_scope",
      "This connector requires tweet.read, users.read, and offline.access.",
    );
  }
  return vault.update(async (state) => {
    if (input.grant_type === "authorization_code") {
      const code = input.code ? state.codes[hash(input.code)] : undefined;
      if (
        !code ||
        input.redirect_uri !== x.config.redirectUri ||
        !input.code_verifier ||
        !matches(hash(input.code_verifier), code.codeChallenge)
      ) {
        throw new OAuthFailure(
          "invalid_grant",
          "Invalid, expired, or already used authorization code.",
        );
      }
      delete state.codes[hash(input.code ?? "")];
      return issueTokens(state, code.grant);
    }
    const entry = Object.entries(state.sessions).find(
      ([, session]) =>
        input.refresh_token && matches(hash(input.refresh_token), session.refreshTokenHash),
    );
    if (!entry)
      throw new OAuthFailure("invalid_grant", "Invalid or expired refresh token. Connect X again.");
    const [sessionId, session] = entry;
    const grant = await x.exchange(
      { grant_type: "refresh_token", refresh_token: session.grant.refreshToken },
      request.signal,
      session.grant.refreshToken,
    );
    return issueTokens(state, grant, sessionId);
  });
}
