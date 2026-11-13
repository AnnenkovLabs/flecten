import { z } from "zod";
import { scopes, type XConfig } from "./config";
import type { XGrant } from "./state";

const Token = z.object({
  token_type: z.string(),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string(),
});

export class OAuthFailure extends Error {
  constructor(
    readonly error: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export class XOAuth {
  constructor(
    readonly config: XConfig,
    readonly fetcher: typeof fetch = fetch,
  ) {}

  async exchange(
    parameters: Record<string, string>,
    signal: AbortSignal,
    previousRefreshToken?: string,
  ): Promise<XGrant> {
    let response: Response;
    try {
      response = await this.fetcher("https://api.x.com/2/oauth2/token", {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${encodeURIComponent(this.config.xClientId)}:${encodeURIComponent(this.config.xClientSecret)}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams(parameters),
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      });
    } catch {
      throw new OAuthFailure(
        "temporarily_unavailable",
        "X authorization is unavailable. Try connecting again.",
        503,
      );
    }
    if (!response.ok) {
      const invalid = response.status === 400 || response.status === 401;
      throw new OAuthFailure(
        invalid ? "invalid_grant" : "temporarily_unavailable",
        invalid
          ? "X rejected authorization. Connect the account again."
          : "X authorization is unavailable. Try again later.",
        invalid ? 400 : 503,
      );
    }
    const parsed = Token.safeParse(await response.json().catch(() => null));
    if (!parsed.success || parsed.data.token_type.toLowerCase() !== "bearer") {
      throw new OAuthFailure("server_error", "X returned an invalid token response.", 502);
    }
    const token = parsed.data;
    if (!scopes.every((scope) => token.scope.split(" ").includes(scope))) {
      throw new OAuthFailure("invalid_scope", "X did not grant all required read permissions.");
    }
    const refreshToken = token.refresh_token ?? previousRefreshToken;
    if (!refreshToken)
      throw new OAuthFailure(
        "invalid_grant",
        "X did not issue an offline access token. Connect again.",
      );
    return {
      accessToken: token.access_token,
      refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000,
      scope: scopes.join(" "),
    };
  }
}
