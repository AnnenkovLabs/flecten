import { resolve } from "node:path";
import { z } from "zod";

export const scopes = ["tweet.read", "users.read", "offline.access"] as const;

const Environment = z.object({
  X_CONNECTOR_URL: z.url(),
  X_CLIENT_ID: z.string().min(1),
  X_CLIENT_SECRET: z.string().min(1),
  X_CONNECTOR_CLIENT_ID: z.string().min(1).default("chatgpt-x"),
  X_CONNECTOR_CLIENT_SECRET: z.string().min(32),
  X_CONNECTOR_ENCRYPTION_KEY: z.string().min(43),
  X_CONNECTOR_REDIRECT_URI: z
    .url()
    .default("https://chatgpt.com/connector_platform_oauth_redirect"),
  X_CONNECTOR_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  X_CONNECTOR_HOST: z.string().default("127.0.0.1"),
  X_CONNECTOR_STORE: z.string().default(".liquid/x-connector/oauth.enc"),
});

function secureUrl(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("OAuth URLs require HTTPS, except on loopback for local testing.");
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new Error("OAuth URLs cannot contain credentials, query parameters, or fragments.");
  }
  return url.toString();
}

export function loadXConfig(environment: Record<string, string | undefined> = process.env) {
  const parsed = Environment.safeParse(environment);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]))].join(", ");
    throw new Error(
      `Configure the X connector environment: ${fields}. See connectors/x-chatgpt/.env.example.`,
    );
  }
  const env = parsed.data;
  const baseUrl = secureUrl(env.X_CONNECTOR_URL);
  if (new URL(baseUrl).pathname !== "/") {
    throw new Error("X_CONNECTOR_URL must be an origin without a path.");
  }
  const encryptionKey = Buffer.from(env.X_CONNECTOR_ENCRYPTION_KEY, "base64url");
  if (
    encryptionKey.length !== 32 ||
    encryptionKey.toString("base64url") !== env.X_CONNECTOR_ENCRYPTION_KEY
  ) {
    throw new Error(
      "X_CONNECTOR_ENCRYPTION_KEY must contain 32 random bytes encoded as base64url.",
    );
  }
  return {
    baseUrl: new URL(baseUrl).origin,
    redirectUri: secureUrl(env.X_CONNECTOR_REDIRECT_URI),
    clientId: env.X_CONNECTOR_CLIENT_ID,
    clientSecret: env.X_CONNECTOR_CLIENT_SECRET,
    xClientId: env.X_CLIENT_ID,
    xClientSecret: env.X_CLIENT_SECRET,
    encryptionKey,
    storePath: resolve(env.X_CONNECTOR_STORE),
    port: env.X_CONNECTOR_PORT,
    hostname: env.X_CONNECTOR_HOST,
  };
}

export type XConfig = ReturnType<typeof loadXConfig>;
