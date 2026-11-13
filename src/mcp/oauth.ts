import { z } from "zod";
import type { McpHttpServerConfig } from "./config";

export interface TokenProvider {
  getToken(): string | undefined | Promise<string | undefined>;
  refresh?(): string | undefined | Promise<string | undefined>;
}

export function authorizationHeaders(token: string | undefined): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

export interface InMemoryTokenProviderOptions {
  token?: string;
  refresh?: () => string | undefined | Promise<string | undefined>;
}

export class InMemoryTokenProvider implements TokenProvider {
  #token: string | undefined;
  readonly #refresh: InMemoryTokenProviderOptions["refresh"];
  refreshCount = 0;

  constructor(options: InMemoryTokenProviderOptions = {}) {
    this.#token = options.token;
    this.#refresh = options.refresh;
  }

  getToken(): string | undefined {
    return this.#token;
  }

  setToken(token: string | undefined): void {
    this.#token = token;
  }

  async refresh(): Promise<string | undefined> {
    if (!this.#refresh) return undefined;
    this.refreshCount += 1;
    this.#token = await this.#refresh();
    return this.#token;
  }
}

export const StoredMcpTokenSchema = z
  .object({
    accessToken: z.string().min(1).max(16_384),
    refreshToken: z.string().min(1).max(16_384).optional(),
    tokenType: z.string().min(1).max(64).optional(),
    expiresAt: z.number().int().nonnegative().optional(),
    scopes: z.array(z.string().min(1).max(256)).max(64).optional(),
  })
  .strict();

export type StoredMcpToken = z.infer<typeof StoredMcpTokenSchema>;

export interface McpSecureStore {
  get(key: string): string | undefined | Promise<string | undefined>;
  set(key: string, value: string): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

export type McpOAuthRefresh = (context: {
  server: string;
  config: McpHttpServerConfig;
  token: StoredMcpToken;
}) => StoredMcpToken | undefined | Promise<StoredMcpToken | undefined>;

export type McpOAuthErrorCode =
  | "store_read_failed"
  | "store_write_failed"
  | "invalid_token"
  | "refresh_unavailable"
  | "refresh_failed";

export class McpOAuthError extends Error {
  readonly code: McpOAuthErrorCode;

  constructor(code: McpOAuthErrorCode, message: string) {
    super(message);
    this.name = "McpOAuthError";
    this.code = code;
  }
}

export interface McpOAuthOptions {
  store: McpSecureStore;
  refresh?: McpOAuthRefresh;
  now?: () => number;
}

export interface StoreTokenProviderOptions extends McpOAuthOptions {
  server: string;
  config: McpHttpServerConfig;
}

export interface McpOAuthConsent {
  server: string;
  url: string;
  scopes: string[];
  clientId?: string;
  tokenStorage: "secure-store";
}

export function mcpTokenKey(server: string): string {
  return `mcp.oauth.${server}`;
}

export function mcpOAuthConsent(
  server: string,
  config: McpHttpServerConfig,
): McpOAuthConsent | undefined {
  if (config.oauth === undefined) return undefined;
  return {
    server,
    url: config.url,
    scopes: [...config.oauth.scopes],
    ...(config.oauth.clientId === undefined ? {} : { clientId: config.oauth.clientId }),
    tokenStorage: "secure-store",
  };
}

export class StoreTokenProvider implements TokenProvider {
  readonly #server: string;
  readonly #config: McpHttpServerConfig;
  readonly #store: McpSecureStore;
  readonly #refresh: McpOAuthRefresh | undefined;
  readonly #now: () => number;
  readonly #key: string;
  #token: StoredMcpToken | undefined;
  #loaded = false;

  constructor(options: StoreTokenProviderOptions) {
    this.#server = options.server;
    this.#config = options.config;
    this.#store = options.store;
    this.#refresh = options.refresh;
    this.#now = options.now ?? Date.now;
    this.#key = mcpTokenKey(options.server);
  }

  async getToken(): Promise<string | undefined> {
    await this.#load();
    if (this.#token === undefined) return undefined;
    if (this.#expired(this.#token) && this.#token.refreshToken !== undefined) {
      return (await this.refresh()) ?? this.#token.accessToken;
    }
    return this.#token.accessToken;
  }

  async refresh(): Promise<string | undefined> {
    if (this.#refresh === undefined) {
      throw new McpOAuthError(
        "refresh_unavailable",
        `MCP OAuth refresh is not configured for server "${this.#server}"`,
      );
    }
    await this.#load();
    if (this.#token === undefined) {
      throw new McpOAuthError(
        "refresh_failed",
        `MCP OAuth has no token to refresh for server "${this.#server}"`,
      );
    }
    let next: StoredMcpToken | undefined;
    try {
      next = await this.#refresh({
        server: this.#server,
        config: this.#config,
        token: this.#token,
      });
    } catch (error) {
      throw new McpOAuthError(
        "refresh_failed",
        `MCP OAuth refresh failed for server "${this.#server}": ${this.#reason(error)}`,
      );
    }
    if (next === undefined) {
      throw new McpOAuthError(
        "refresh_failed",
        `MCP OAuth refresh returned no token for server "${this.#server}"`,
      );
    }
    await this.#write(next);
    return next.accessToken;
  }

  current(): StoredMcpToken | undefined {
    return this.#token;
  }

  async clear(): Promise<void> {
    this.#token = undefined;
    this.#loaded = false;
    try {
      await this.#store.delete(this.#key);
    } catch (error) {
      throw new McpOAuthError(
        "store_write_failed",
        `MCP OAuth token store could not clear token for server "${this.#server}": ${this.#reason(error)}`,
      );
    }
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    let stored: string | undefined;
    try {
      stored = await this.#store.get(this.#key);
    } catch (error) {
      this.#loaded = false;
      throw new McpOAuthError(
        "store_read_failed",
        `MCP OAuth token store could not read token for server "${this.#server}": ${this.#reason(error)}`,
      );
    }
    if (stored === undefined) {
      this.#loaded = false;
      return;
    }
    const parsed = StoredMcpTokenSchema.safeParse(this.#parse(stored));
    if (!parsed.success) {
      this.#loaded = false;
      throw new McpOAuthError(
        "invalid_token",
        `MCP OAuth token store returned an invalid token for server "${this.#server}"`,
      );
    }
    this.#token = parsed.data;
  }

  async #write(token: StoredMcpToken): Promise<void> {
    const parsed = StoredMcpTokenSchema.safeParse(token);
    if (!parsed.success) {
      throw new McpOAuthError(
        "invalid_token",
        `MCP OAuth refresh returned an invalid token for server "${this.#server}"`,
      );
    }
    try {
      await this.#store.set(this.#key, JSON.stringify(parsed.data));
    } catch (error) {
      throw new McpOAuthError(
        "store_write_failed",
        `MCP OAuth token store could not save token for server "${this.#server}": ${this.#reason(error)}`,
      );
    }
    this.#token = parsed.data;
    this.#loaded = true;
  }

  #expired(token: StoredMcpToken): boolean {
    return token.expiresAt !== undefined && token.expiresAt <= this.#now();
  }

  #parse(value: string): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  #reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
