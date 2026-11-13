import { resolve } from "node:path";
import { Client, type Tool as McpTool } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { redact } from "../util/redact";
import {
  isHttpServerConfig,
  type McpHttpServerConfig,
  type McpServerConfig,
  type McpStdioServerConfig,
  parseMcpServerConfig,
} from "./config";
import type { McpElicitationBroker } from "./elicitation";
import { McpHealth, type McpHealthSnapshot } from "./health";
import { StreamableHttpClient } from "./http";
import {
  type McpOAuthConsent,
  type McpOAuthOptions,
  mcpOAuthConsent,
  StoreTokenProvider,
  type TokenProvider,
} from "./oauth";
import { DEFAULT_MCP_CATALOG_BUDGET, renderMcpCatalogs } from "./prompt";
import { type McpPrompt, McpPromptCatalog } from "./prompts";
import { type McpResource, McpResourceCatalog, type McpResourceTemplate } from "./resources";
import { sdkRequestClient } from "./sdk-catalogs";
import { listHttpTools, type McpToolDefinition } from "./tools";

const CLIENT_INFO = { name: "flecten", version: "0.1.0" };
const MAX_STDERR = 8000;
const MAX_LOG_LINES = 50;
const MAX_LOG_LINE = 1000;

export type McpServerState = "connecting" | "ready" | "degraded" | "closed" | "failed";

export interface McpServerStatus {
  id: string;
  state: McpServerState;
  tools: number;
  available?: number;
  protocol?: string;
  error?: string;
  lastError?: string;
  nextRetryAt?: number;
  resources?: number;
  resourceTemplates?: number;
  prompts?: number;
  diagnostics?: string[];
  readOnly?: boolean;
  oauth?: McpOAuthConsent;
  logs?: string[];
}

export interface McpServerCatalogs {
  server: string;
  resources: McpResourceCatalog;
  prompts: McpPromptCatalog;
  resourceItems: McpResource[];
  resourceTemplates: McpResourceTemplate[];
  promptItems: McpPrompt[];
}

export interface McpSessionOptions {
  tokenProvider?: TokenProvider;
  tokenProviderFor?: (server: string, config: McpHttpServerConfig) => TokenProvider | undefined;
  oauth?: McpOAuthOptions;
  catalogBudgetChars?: number;
  health?: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    maxAttempts?: number;
    now?: () => number;
  };
  elicitation?: McpElicitationBroker;
}

export interface LoadedTool {
  definition: McpToolDefinition;
  sdk?: McpTool | undefined;
}

export interface CatalogSurface {
  resources: McpResourceCatalog;
  prompts: McpPromptCatalog;
  resourceItems: McpResource[];
  resourceTemplates: McpResourceTemplate[];
  promptItems: McpPrompt[];
  refresh?: Promise<void> | undefined;
}

export interface McpConnection {
  id: string;
  config: McpServerConfig;
  status: McpServerStatus;
  tools: LoadedTool[];
  available?: number | undefined;
  protocol?: string | undefined;
  instructions?: string | undefined;
  diagnostics: string[];
  sdk?: Client | undefined;
  httpClient?: StreamableHttpClient | undefined;
  catalogs?: CatalogSurface | undefined;
  health?: McpHealth | undefined;
  logs: string[];
  toolsRefresh?: Promise<void> | undefined;
}

export function pushMcpLog(connection: McpConnection, message: string): void {
  const line = redact(message).trimEnd().slice(0, MAX_LOG_LINE);
  if (line.length === 0) return;
  connection.logs.push(line);
  if (connection.logs.length > MAX_LOG_LINES) {
    connection.logs.splice(0, connection.logs.length - MAX_LOG_LINES);
  }
  connection.status.logs = connection.logs.slice(-10);
}

function connectionOptions(
  config: McpStdioServerConfig,
  elicitation: boolean,
): ConstructorParameters<typeof Client>[1] {
  const mode =
    config.protocol === "auto"
      ? "auto"
      : config.protocol === "legacy"
        ? "legacy"
        : { pin: config.protocol };
  return {
    listMaxPages: 4,
    versionNegotiation: {
      mode,
      probe: { timeoutMs: Math.min(config.timeoutMs, 10_000), maxRetries: 0 },
    },
    ...(elicitation ? { capabilities: { elicitation: {} } } : {}),
  };
}

function errorText(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

function connectError(error: unknown, stderr: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const detail = stderr.trim();
  return redact(detail ? `${message}\n${detail.slice(-2000)}` : message);
}

function replace<T>(target: T[], source: readonly T[]): void {
  target.length = 0;
  target.push(...source);
}

async function optional<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch {
    return undefined;
  }
}

export function applyHealth(connection: McpConnection, snapshot: McpHealthSnapshot): void {
  const status = connection.status;
  status.state = snapshot.state;
  if (snapshot.lastError === undefined) {
    delete status.error;
    delete status.lastError;
  } else {
    const error = redact(snapshot.lastError);
    status.error = error;
    status.lastError = error;
    pushMcpLog(connection, error);
  }
  if (snapshot.nextRetryAt === undefined) delete status.nextRetryAt;
  else status.nextRetryAt = snapshot.nextRetryAt;
}

export function updateCatalogStatus(connection: McpConnection): void {
  const catalogs = connection.catalogs;
  if (catalogs === undefined) return;
  connection.status.resources = catalogs.resourceItems.length;
  connection.status.prompts = catalogs.promptItems.length;
  if (catalogs.resourceTemplates.length > 0) {
    connection.status.resourceTemplates = catalogs.resourceTemplates.length;
  } else {
    delete connection.status.resourceTemplates;
  }
}

export function refreshInstructions(connection: McpConnection, options: McpSessionOptions): void {
  const catalogs = connection.catalogs;
  const base = connection.sdk?.getInstructions() ?? connection.httpClient?.instructions ?? "";
  if (catalogs === undefined) {
    if (base.length === 0) delete connection.instructions;
    else connection.instructions = base;
    return;
  }
  const catalog = renderMcpCatalogs(
    [
      {
        server: connection.id,
        resources: catalogs.resourceItems,
        resourceTemplates: catalogs.resourceTemplates,
        prompts: catalogs.promptItems,
      },
    ],
    options.catalogBudgetChars ?? DEFAULT_MCP_CATALOG_BUDGET,
  );
  const parts = [base, catalog ?? ""].filter((part) => part.length > 0);
  if (parts.length === 0) delete connection.instructions;
  else connection.instructions = parts.join("\n\n");
}

export async function loadCatalogs(connection: McpConnection, signal?: AbortSignal): Promise<void> {
  const catalogs = connection.catalogs;
  if (catalogs === undefined) return;
  const [resources, templates, prompts] = await Promise.all([
    optional(() => catalogs.resources.listAllResources(signal)),
    optional(() => catalogs.resources.listAllResourceTemplates(signal)),
    optional(() => catalogs.prompts.listAllPrompts(signal)),
  ]);
  if (resources !== undefined) replace(catalogs.resourceItems, resources);
  if (templates !== undefined) replace(catalogs.resourceTemplates, templates);
  if (prompts !== undefined) replace(catalogs.promptItems, prompts);
  updateCatalogStatus(connection);
}

export async function loadConnectionTools(
  connection: McpConnection,
  signal?: AbortSignal,
): Promise<void> {
  const config = connection.config;
  if (connection.sdk !== undefined) {
    const listed = await connection.sdk.listTools(undefined, {
      timeout: config.timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
    const sorted = listed.tools
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, config.maxTools);
    replace(
      connection.tools,
      sorted.map((tool) => ({ definition: tool, sdk: tool })),
    );
    connection.available = listed.tools.length;
    return;
  }
  if (connection.httpClient !== undefined && isHttpServerConfig(config)) {
    const timeout = signal ?? AbortSignal.timeout(config.timeoutMs);
    const listed = await listHttpTools(connection.httpClient, config, timeout);
    replace(
      connection.tools,
      listed.slice(0, config.maxTools).map((definition) => ({ definition })),
    );
    connection.available = listed.length;
  }
}

function scheduleCatalogRefresh(
  connection: McpConnection,
  options: McpSessionOptions,
  onChange: () => void,
): void {
  const catalogs = connection.catalogs;
  if (catalogs === undefined) return;
  const run = async (): Promise<void> => {
    try {
      await loadCatalogs(connection);
      refreshInstructions(connection, options);
      onChange();
    } catch (error) {
      pushMcpLog(connection, `MCP catalog refresh failed: ${errorText(error)}`);
    }
  };
  catalogs.refresh = (catalogs.refresh ?? Promise.resolve()).catch(() => undefined).then(run);
}

export function scheduleToolsRefresh(connection: McpConnection, onChange: () => void): void {
  const run = async (): Promise<void> => {
    try {
      await loadConnectionTools(connection);
      onChange();
    } catch (error) {
      pushMcpLog(connection, `MCP tools/list_changed refresh failed: ${errorText(error)}`);
    }
  };
  connection.toolsRefresh = (connection.toolsRefresh ?? Promise.resolve())
    .catch(() => undefined)
    .then(run);
}

async function connectStdio(
  id: string,
  config: McpStdioServerConfig,
  cwd: string,
  options: McpSessionOptions,
  onChange: () => void,
): Promise<{ connection?: McpConnection; status: McpServerStatus }> {
  let client: Client | undefined;
  let stderr = "";
  try {
    client = new Client(CLIENT_INFO, connectionOptions(config, options.elicitation !== undefined));
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...getDefaultEnvironment(), ...config.env },
      cwd: resolve(cwd, config.cwd ?? "."),
      stderr: "pipe",
      maxBufferSize: 10 * 1024 * 1024,
    });
    transport.stderr?.on("data", (chunk: Uint8Array | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-MAX_STDERR);
    });
    await client.connect(transport, { timeout: Math.min(config.timeoutMs, 15_000) });
    const protocol = client.getNegotiatedProtocolVersion();
    const status: McpServerStatus = {
      id,
      state: "ready",
      tools: 0,
      ...(protocol ? { protocol } : {}),
      ...(config.readOnly === true ? { readOnly: true } : {}),
    };
    const connection: McpConnection = {
      id,
      config,
      status,
      tools: [],
      diagnostics: [],
      logs: [],
      sdk: client,
      ...(protocol ? { protocol } : {}),
    };
    if (stderr.trim().length > 0) pushMcpLog(connection, stderr.trim());
    await loadConnectionTools(connection);

    const capabilities = client.getServerCapabilities();
    if (capabilities?.resources !== undefined || capabilities?.prompts !== undefined) {
      const adapter = sdkRequestClient(client);
      connection.catalogs = {
        resources: new McpResourceCatalog(adapter),
        prompts: new McpPromptCatalog(adapter),
        resourceItems: [],
        resourceTemplates: [],
        promptItems: [],
      };
      await loadCatalogs(connection);
      refreshInstructions(connection, options);
      connection.catalogs.resources.onChange(() =>
        scheduleCatalogRefresh(connection, options, onChange),
      );
      connection.catalogs.prompts.onChange(() =>
        scheduleCatalogRefresh(connection, options, onChange),
      );
    } else {
      refreshInstructions(connection, options);
    }

    client.setNotificationHandler("notifications/tools/list_changed", () => {
      scheduleToolsRefresh(connection, onChange);
    });
    if (options.elicitation !== undefined) {
      const broker = options.elicitation;
      client.setRequestHandler("elicitation/create", async (request, context) => {
        try {
          return await broker.request(
            id,
            request.params,
            AbortSignal.any([context.mcpReq.signal, AbortSignal.timeout(config.timeoutMs)]),
          );
        } catch {
          return { action: "decline" as const };
        }
      });
    }

    return {
      connection,
      status,
    };
  } catch (error) {
    await client?.close().catch(() => undefined);
    return {
      status: {
        id,
        state: "failed",
        tools: 0,
        error: connectError(error, stderr),
      },
    };
  }
}

async function connectHttp(
  id: string,
  config: McpHttpServerConfig,
  options: McpSessionOptions,
  onChange: () => void,
): Promise<{ connection: McpConnection; status: McpServerStatus }> {
  const status: McpServerStatus = {
    id,
    state: "connecting",
    tools: 0,
    ...(config.readOnly === true ? { readOnly: true } : {}),
  };
  const consent = mcpOAuthConsent(id, config);
  if (consent !== undefined) status.oauth = consent;
  const tokenProvider =
    options.oauth !== undefined && config.oauth !== undefined
      ? new StoreTokenProvider({ ...options.oauth, server: id, config })
      : (options.tokenProviderFor?.(id, config) ?? options.tokenProvider);
  const connection: McpConnection = {
    id,
    config,
    status,
    tools: [],
    diagnostics: [],
    logs: [],
  };
  const broker = options.elicitation;
  const client = new StreamableHttpClient({
    url: config.url,
    headers: config.headers,
    timeoutMs: config.timeoutMs,
    ...(config.protocolVersion === undefined ? {} : { protocolVersion: config.protocolVersion }),
    ...(tokenProvider === undefined ? {} : { tokenProvider }),
    retry: { attempts: 1 },
    ...(broker
      ? {
          onRequest: (method: string, params: unknown, signal: AbortSignal) => {
            if (method !== "elicitation/create")
              throw new Error(`Unsupported MCP server request: ${method}`);
            return broker.request(id, params, signal);
          },
        }
      : {}),
  });
  connection.httpClient = client;
  connection.catalogs = {
    resources: new McpResourceCatalog(client),
    prompts: new McpPromptCatalog(client),
    resourceItems: [],
    resourceTemplates: [],
    promptItems: [],
  };

  const health = new McpHealth({
    ...(options.health ?? {}),
    connect: async (signal) => {
      await client.connect(signal);
      await loadConnectionTools(connection, signal);
      connection.protocol = client.protocolVersion;
      await loadCatalogs(connection, signal);
      refreshInstructions(connection, options);
    },
    onChange: (snapshot) => {
      applyHealth(connection, snapshot);
      if (snapshot.state === "ready" || snapshot.state === "degraded") onChange();
    },
  });
  connection.health = health;

  client.onNotification((notification) => {
    if (notification.method === "notifications/tools/list_changed") {
      scheduleToolsRefresh(connection, onChange);
    }
  });
  connection.catalogs.resources.onChange(() =>
    scheduleCatalogRefresh(connection, options, onChange),
  );
  connection.catalogs.prompts.onChange(() => scheduleCatalogRefresh(connection, options, onChange));

  await health.reconnect();
  return { connection, status };
}

export async function connectServer(
  id: string,
  config: McpServerConfig,
  cwd: string,
  options: McpSessionOptions,
  onChange: () => void,
): Promise<{ connection?: McpConnection; status: McpServerStatus }> {
  return isHttpServerConfig(config)
    ? connectHttp(id, config, options, onChange)
    : connectStdio(id, config, cwd, options, onChange);
}

export function parseSessionConfig(input: unknown): McpServerConfig {
  if (typeof input === "object" && input !== null && "url" in input) {
    const rest = { ...(input as Record<string, unknown>) };
    delete rest.env;
    return parseMcpServerConfig(rest);
  }
  return parseMcpServerConfig(input);
}
