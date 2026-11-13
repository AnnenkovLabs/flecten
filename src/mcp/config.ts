import { z } from "zod";

const HeadersSchema = z
  .record(z.string().min(1).max(128), z.string().max(8192))
  .default({})
  .refine((headers) => Object.keys(headers).length <= 64, "at most 64 headers");

export const McpOAuthConfigSchema = z.object({
  clientId: z.string().min(1).max(512).optional(),
  scopes: z.array(z.string().min(1).max(256)).max(32).default([]),
});

const HttpUrlSchema = z
  .url()
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "MCP HTTP url must use http or https",
  );

const ToolNameSchema = z.string().min(1).max(256);

const McpAccessSchema = {
  allowTools: z.array(ToolNameSchema).max(128).optional(),
  readOnly: z.boolean().optional(),
  contextTokens: z.number().int().min(64).max(100_000).optional(),
};

export const McpHttpServerConfigSchema = z
  .object({
    url: HttpUrlSchema,
    headers: HeadersSchema,
    oauth: McpOAuthConfigSchema.optional(),
    enabled: z.boolean().default(true),
    timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
    maxTools: z.number().int().min(1).max(128).default(64),
    protocolVersion: z.string().min(1).max(64).optional(),
    ...McpAccessSchema,
  })
  .strict();

export const McpStdioServerConfigSchema = z
  .object({
    command: z.string().trim().min(1).max(2048),
    args: z.array(z.string().max(8192)).max(128).default([]),
    env: z
      .record(z.string().min(1).max(128), z.string().max(8192))
      .default({})
      .refine((env) => Object.keys(env).length <= 64, "at most 64 environment variables"),
    cwd: z.string().trim().min(1).max(2048).optional(),
    enabled: z.boolean().default(true),
    protocol: z.enum(["auto", "legacy", "2026-07-28"]).default("auto"),
    timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
    maxTools: z.number().int().min(1).max(128).default(64),
    ...McpAccessSchema,
  })
  .strict();

export const McpServerConfigSchema = z.union([
  McpHttpServerConfigSchema,
  McpStdioServerConfigSchema,
]);

export const McpConfigSchema = z.object({
  servers: z
    .record(
      z.string(),
      z.union([
        McpHttpServerConfigSchema.extend({ env: z.record(z.string(), z.string()).default({}) }),
        McpStdioServerConfigSchema,
      ]),
    )
    .default({}),
});

export type McpOAuthConfig = z.infer<typeof McpOAuthConfigSchema>;
export type McpHttpServerConfig = z.infer<typeof McpHttpServerConfigSchema>;
export type McpStdioServerConfig = z.infer<typeof McpStdioServerConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export function parseMcpServerConfig(input: unknown): McpServerConfig {
  return McpServerConfigSchema.parse(input);
}

export function isHttpServerConfig(config: McpServerConfig): config is McpHttpServerConfig {
  return "url" in config;
}
