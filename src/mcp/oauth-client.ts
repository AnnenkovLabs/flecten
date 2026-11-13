import { randomBytes } from "node:crypto";
import {
  type AuthOptions,
  auth,
  type OAuthClientInformationContext,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import type { McpHttpServerConfig } from "./config";
import type { McpSecureStore, TokenProvider } from "./oauth";

const TokenSchema = z.object({
  access_token: z.string().min(1).max(16384),
  token_type: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  issuer: z.string().optional(),
  expiresAt: z.number().optional(),
});
const ClientSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().optional(),
    issuer: z.string().optional(),
  })
  .passthrough();

export interface McpAuthorization {
  server: string;
  state: "pending" | "authorized" | "error";
  url?: string;
  error?: string;
}

/** SDK OAuth provides discovery, PKCE, refresh and issuer binding. Tokens never enter the UI. */
export class McpOAuthClient implements OAuthClientProvider, TokenProvider {
  readonly #id: string;
  readonly #config: McpHttpServerConfig;
  readonly #store: McpSecureStore;
  readonly #connected: () => Promise<void>;
  #redirect: string | undefined;
  #verifier = "";
  #state = "";
  #server: ReturnType<typeof Bun.serve> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #status: McpAuthorization | undefined;
  #latestIssuer: string | undefined;
  #discovery: OAuthDiscoveryState | undefined;
  #refreshing: Promise<string | undefined> | undefined;

  constructor(
    id: string,
    config: McpHttpServerConfig,
    store: McpSecureStore,
    connected: () => Promise<void>,
  ) {
    this.#id = id;
    this.#config = config;
    this.#store = store;
    this.#connected = connected;
  }

  get redirectUrl(): string | undefined {
    return this.#redirect;
  }
  get clientMetadata() {
    return {
      client_name: "Flecten",
      redirect_uris: this.#redirect ? [this.#redirect] : [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  saveDiscoveryState(value: OAuthDiscoveryState): void {
    this.#discovery = value;
  }
  discoveryState(): OAuthDiscoveryState | undefined {
    return this.#discovery;
  }
  state(): string {
    return this.#state;
  }
  status(): McpAuthorization | undefined {
    return this.#status;
  }

  async clientInformation(
    ctx?: OAuthClientInformationContext,
  ): Promise<StoredOAuthClientInformation | undefined> {
    const key = this.#key("client", ctx);
    const raw = await this.#json(key);
    const parsed = ClientSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    return this.#config.oauth?.clientId
      ? { client_id: this.#config.oauth.clientId, ...(ctx ? { issuer: ctx.issuer } : {}) }
      : undefined;
  }
  async saveClientInformation(
    value: StoredOAuthClientInformation,
    ctx?: OAuthClientInformationContext,
  ): Promise<void> {
    await this.#store.set(this.#key("client", ctx), JSON.stringify(value));
  }
  async tokens(ctx?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    const issuer = ctx?.issuer ?? this.#latestIssuer ?? (await this.#store.get("issuer"));
    if (issuer) this.#latestIssuer = issuer;
    const raw = await this.#json(`tokens.${issuer ?? ""}`);
    const parsed = TokenSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }
  async saveTokens(value: StoredOAuthTokens, ctx?: OAuthClientInformationContext): Promise<void> {
    const issuer = ctx?.issuer ?? value.issuer ?? this.#latestIssuer ?? "";
    this.#latestIssuer = issuer;
    const expiresAt =
      value.expires_in === undefined ? undefined : Date.now() + value.expires_in * 1000;
    await this.#store.set(`tokens.${issuer}`, JSON.stringify({ ...value, expiresAt }));
    await this.#store.set("issuer", issuer);
  }
  redirectToAuthorization(url: URL): void {
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    ) {
      throw new Error("OAuth authorization URL must use HTTPS");
    }
    this.#status = { server: this.#id, state: "pending", url: url.href };
  }
  saveCodeVerifier(value: string): void {
    this.#verifier = value;
  }
  codeVerifier(): string {
    return this.#verifier;
  }

  async getToken(): Promise<string | undefined> {
    const token = await this.tokens();
    if (!token) return undefined;
    const parsed = TokenSchema.parse(token);
    if (parsed.expiresAt !== undefined && parsed.expiresAt <= Date.now()) return this.refresh();
    return token.access_token;
  }
  refresh(): Promise<string | undefined> {
    this.#refreshing ??= this.#refresh().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }
  async #refresh(): Promise<string | undefined> {
    const token = await this.tokens();
    if (!token?.refresh_token) return undefined;
    const outcome = await auth(this, { serverUrl: this.#config.url, fetchFn: this.#fetch });
    if (outcome !== "AUTHORIZED") throw new Error("MCP OAuth requires reauthorization in settings");
    return (await this.tokens())?.access_token;
  }

  async start(): Promise<McpAuthorization> {
    this.cancel();
    this.#state = randomBytes(32).toString("base64url");
    this.#server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => this.#callback(request),
    });
    this.#redirect = `http://127.0.0.1:${this.#server.port}/oauth/callback`;
    this.#timer = setTimeout(() => {
      this.cancel();
      this.#status = {
        server: this.#id,
        state: "error",
        error: "Время авторизации истекло. Повторите вход.",
      };
    }, 5 * 60_000);
    this.#timer.unref?.();
    try {
      const result = await auth(this, {
        serverUrl: this.#config.url,
        scope: this.#config.oauth?.scopes.join(" ") ?? "",
        forceReauthorization: true,
        fetchFn: this.#fetch,
      });
      if (result === "AUTHORIZED") {
        this.#status = { server: this.#id, state: "authorized" };
        this.cancel();
        await this.#connected();
      }
      if (!this.#status) throw new Error("OAuth did not provide an authorization URL");
      return this.#status;
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  cancel(): void {
    clearTimeout(this.#timer);
    this.#server?.stop(true);
    this.#server = undefined;
    this.#verifier = "";
    this.#state = "";
    this.#discovery = undefined;
  }
  async #callback(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/oauth/callback") return new Response("Not found", { status: 404 });
    if (!this.#state || url.searchParams.get("state") !== this.#state)
      return new Response("Invalid OAuth state", { status: 400 });
    this.#state = "";
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error"))
      return new Response("Authorization declined. Close this tab and retry in Flecten.", {
        status: 400,
      });
    try {
      const iss = url.searchParams.get("iss");
      await auth(this, {
        serverUrl: this.#config.url,
        authorizationCode: code,
        ...(iss === null ? {} : { iss }),
        fetchFn: this.#fetch,
      });
      this.#status = { server: this.#id, state: "authorized" };
      void this.#connected().catch((error: unknown) => {
        this.#status = {
          server: this.#id,
          state: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      });
      setTimeout(() => this.cancel(), 50).unref?.();
      return new Response("Authorization complete. You may close this tab and return to Flecten.");
    } catch (error) {
      this.#status = {
        server: this.#id,
        state: "error",
        error: error instanceof Error ? error.message : String(error),
      };
      return new Response("Authorization failed. Return to Flecten and retry.", {
        status: 400,
      });
    }
  }
  readonly #fetch: NonNullable<AuthOptions["fetchFn"]> = (input, init) =>
    fetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(this.#config.timeoutMs),
    });
  #key(kind: string, ctx?: OAuthClientInformationContext): string {
    return `${kind}.${ctx?.issuer ?? this.#latestIssuer ?? ""}`;
  }
  async #json(key: string): Promise<unknown> {
    const text = await this.#store.get(key);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Invalid MCP OAuth credentials in secret storage");
    }
  }
}
