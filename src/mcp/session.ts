import type { Tool } from "../tools/types";
import { callerFor } from "./caller";
import { createMcpCatalogTools } from "./catalog-tools";
import {
  connectServer,
  type McpConnection,
  type McpServerCatalogs,
  type McpServerState,
  type McpServerStatus,
  type McpSessionOptions,
  parseSessionConfig,
  updateCatalogStatus,
} from "./connection";
import {
  DEFAULT_MCP_CONTEXT_TOKENS,
  type McpContextResult,
  renderPromptContext,
  renderResourceContext,
} from "./context";
import { McpElicitationBroker } from "./elicitation";
import type { McpHealthCounters } from "./health";
import { createMcpTool, MAX_MCP_TOOLS, mcpToolName } from "./tools";

export type {
  McpServerCatalogs,
  McpServerState,
  McpServerStatus,
  McpSessionOptions,
} from "./connection";

export interface McpRuntime {
  tools: Tool[];
  statuses: McpServerStatus[];
  instructions: Array<{ server: string; text: string }>;
  catalogs?: McpServerCatalogs[];
  close(): Promise<void>;
}

export interface McpServerHealthView {
  server: string;
  state: McpServerState;
  lastError?: string;
  nextRetryAt?: number;
  counters?: McpHealthCounters;
}

export interface McpContextOptions {
  budgetTokens?: number;
  signal?: AbortSignal;
}

export interface McpRuntimeLog {
  server: string;
  message: string;
}

export interface McpSessionRuntime extends McpRuntime {
  elicitation: McpElicitationBroker;
  health(serverId?: string): McpServerHealthView[];
  reconnect(serverId?: string): Promise<McpServerStatus[]>;
  attachResource(
    serverId: string,
    uri: string,
    options?: McpContextOptions,
  ): Promise<McpContextResult>;
  invokePrompt(
    serverId: string,
    name: string,
    args?: Record<string, string>,
    options?: McpContextOptions,
  ): Promise<McpContextResult>;
  logs(serverId?: string, limit?: number): McpRuntimeLog[];
}

interface ServerEntry {
  id: string;
  config: ReturnType<typeof parseSessionConfig>;
  connection?: McpConnection | undefined;
}

function replaceStatus(target: McpServerStatus, source: McpServerStatus): void {
  for (const key of Object.keys(target)) {
    delete (target as unknown as Record<string, unknown>)[key];
  }
  Object.assign(target, source);
}

function boundedSignal(config: { timeoutMs: number }, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function contextBudget(connection: McpConnection, requested?: number): number {
  return requested ?? connection.config.contextTokens ?? DEFAULT_MCP_CONTEXT_TOKENS;
}

async function closeConnection(connection: McpConnection): Promise<void> {
  connection.health?.close();
  connection.catalogs?.resources.close();
  connection.catalogs?.prompts.close();
  await connection.httpClient?.close().catch(() => undefined);
  await connection.sdk?.close().catch(() => undefined);
  connection.status.state = "closed";
}

export async function connectMcpServers(
  servers: Record<string, unknown>,
  cwd: string,
  options: McpSessionOptions = {},
): Promise<McpSessionRuntime> {
  const parsed: Array<{ id: string; config: ReturnType<typeof parseSessionConfig> }> = [];
  const statuses: McpServerStatus[] = [];

  for (const [id, input] of Object.entries(servers)) {
    try {
      const config = parseSessionConfig(input);
      if (config.enabled) parsed.push({ id, config });
    } catch (error) {
      statuses.push({
        id,
        state: "failed",
        tools: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const ownsBroker = options.elicitation === undefined;
  const broker = options.elicitation ?? new McpElicitationBroker();
  const connectOptions: McpSessionOptions = { ...options, elicitation: broker };
  let open = true;
  let notify = (): void => undefined;

  const connected = await Promise.all(
    parsed.map(async (entry) => {
      const result = await connectServer(entry.id, entry.config, cwd, connectOptions, () =>
        notify(),
      );
      return { ...entry, ...result };
    }),
  );

  const entries: ServerEntry[] = connected.map((entry) => ({
    id: entry.id,
    config: entry.config,
    ...(entry.connection === undefined ? {} : { connection: entry.connection }),
  }));
  for (const entry of connected) statuses.push(entry.status);

  const tools: Tool[] = [];
  const instructions: Array<{ server: string; text: string }> = [];
  const catalogs: McpServerCatalogs[] = [];

  const rebuild = (): void => {
    tools.length = 0;
    instructions.length = 0;
    catalogs.length = 0;
    let total = 0;

    for (const entry of entries) {
      const connection = entry.connection;
      if (connection === undefined) continue;
      const diagnostics: string[] = [];
      const allow = connection.config.allowTools ?? [];
      const allowSet = allow.length > 0 ? new Set(allow) : undefined;
      let exposed = 0;
      let filtered = 0;

      for (const loaded of connection.tools) {
        if (total >= MAX_MCP_TOOLS) {
          diagnostics.push(`global MCP tool limit ${MAX_MCP_TOOLS} reached`);
          break;
        }
        if (allowSet !== undefined && !allowSet.has(loaded.definition.name)) {
          filtered += 1;
          continue;
        }
        const name = mcpToolName(connection.id, loaded.definition.name);
        if (tools.some((tool) => tool.name === name)) {
          diagnostics.push(`tool name collision for "${loaded.definition.name}"; skipped`);
          continue;
        }
        const tool = createMcpTool(
          connection.id,
          connection.config,
          callerFor(connection, loaded),
          loaded.definition,
          name,
          { readOnly: connection.config.readOnly === true },
        );
        if (tool === undefined) {
          diagnostics.push(
            `tool "${loaded.definition.name}" has an invalid or oversized inputSchema; skipped`,
          );
          continue;
        }
        tools.push(tool);
        exposed += 1;
        total += 1;
      }

      if (filtered > 0) {
        diagnostics.push(`allowTools excluded ${filtered} server tools`);
      }
      if (connection.available !== undefined && connection.available > connection.tools.length) {
        diagnostics.push(
          `exposed ${connection.tools.length} of ${connection.available} tools; maxTools is ${connection.config.maxTools}`,
        );
      }

      if (connection.catalogs !== undefined) {
        const extra = createMcpCatalogTools(connection.id, connection.config, {
          resources: connection.catalogs.resources,
          prompts: connection.catalogs.prompts,
          resourceItems: connection.catalogs.resourceItems,
          promptItems: connection.catalogs.promptItems,
        });
        for (const tool of extra) {
          if (total >= MAX_MCP_TOOLS) {
            diagnostics.push(`global MCP tool limit ${MAX_MCP_TOOLS} reached`);
            break;
          }
          if (tools.some((existing) => existing.name === tool.name)) {
            diagnostics.push(`tool name collision for "${tool.name}"; skipped`);
            continue;
          }
          tools.push(tool);
          exposed += 1;
          total += 1;
        }
        catalogs.push({
          server: connection.id,
          resources: connection.catalogs.resources,
          prompts: connection.catalogs.prompts,
          resourceItems: connection.catalogs.resourceItems,
          resourceTemplates: connection.catalogs.resourceTemplates,
          promptItems: connection.catalogs.promptItems,
        });
        updateCatalogStatus(connection);
      }

      connection.status.tools = exposed;
      if (connection.available !== undefined) connection.status.available = connection.available;
      if (connection.protocol !== undefined) connection.status.protocol = connection.protocol;
      if (connection.config.readOnly === true) connection.status.readOnly = true;
      else delete connection.status.readOnly;
      if (diagnostics.length > 0) connection.status.diagnostics = diagnostics;
      else delete connection.status.diagnostics;
      if (connection.instructions !== undefined) {
        instructions.push({ server: connection.id, text: connection.instructions });
      }
    }
  };

  notify = () => {
    if (open) rebuild();
  };

  const findEntry = (serverId: string): ServerEntry | undefined =>
    entries.find((entry) => entry.id === serverId);

  const requireEntry = (serverId: string): ServerEntry => {
    const entry = findEntry(serverId);
    if (entry === undefined) throw new Error(`Unknown MCP server "${serverId}"`);
    return entry;
  };

  const runtime: McpSessionRuntime = {
    tools,
    statuses,
    instructions,
    catalogs,
    elicitation: broker,
    health(serverId?: string): McpServerHealthView[] {
      return statuses
        .filter((status) => serverId === undefined || status.id === serverId)
        .map((status) => {
          const connection = findEntry(status.id)?.connection;
          const counters = connection?.health?.snapshot().counters;
          const lastError = status.lastError ?? status.error;
          return {
            server: status.id,
            state: status.state,
            ...(lastError === undefined ? {} : { lastError }),
            ...(status.nextRetryAt === undefined ? {} : { nextRetryAt: status.nextRetryAt }),
            ...(counters === undefined ? {} : { counters }),
          };
        });
    },
    async reconnect(serverId?: string): Promise<McpServerStatus[]> {
      const targets =
        serverId === undefined ? entries : entries.filter((entry) => entry.id === serverId);
      if (serverId !== undefined && targets.length === 0) {
        throw new Error(`Unknown MCP server "${serverId}"`);
      }
      const results: McpServerStatus[] = [];
      for (const entry of targets) {
        const existing = entry.connection;
        if (existing?.health !== undefined) {
          await existing.health.reconnect();
          results.push(existing.status);
          notify();
          continue;
        }
        if (existing !== undefined) {
          broker.cancelServer(entry.id);
          await closeConnection(existing);
        }
        const result = await connectServer(entry.id, entry.config, cwd, connectOptions, () =>
          notify(),
        );
        const current = statuses.find((status) => status.id === entry.id);
        if (result.connection !== undefined) {
          entry.connection = result.connection;
          if (current !== undefined) {
            replaceStatus(current, result.status);
            result.connection.status = current;
          } else {
            statuses.push(result.status);
          }
        } else if (current !== undefined) {
          replaceStatus(current, result.status);
        } else {
          statuses.push(result.status);
        }
        results.push(current ?? result.status);
        notify();
      }
      return results;
    },
    async attachResource(serverId, uri, contextOptions = {}): Promise<McpContextResult> {
      const connection = requireEntry(serverId).connection;
      if (connection?.catalogs === undefined) {
        throw new Error(`MCP server "${serverId}" does not expose resources`);
      }
      const signal = boundedSignal(connection.config, contextOptions.signal);
      const contents = await connection.catalogs.resources.readResource(uri, signal);
      return renderResourceContext(
        serverId,
        uri,
        contents,
        contextBudget(connection, contextOptions.budgetTokens),
      );
    },
    async invokePrompt(serverId, name, args = {}, contextOptions = {}): Promise<McpContextResult> {
      const connection = requireEntry(serverId).connection;
      if (connection?.catalogs === undefined) {
        throw new Error(`MCP server "${serverId}" does not expose prompts`);
      }
      const signal = boundedSignal(connection.config, contextOptions.signal);
      const prompt = await connection.catalogs.prompts.getPrompt(name, args, signal);
      return renderPromptContext(
        serverId,
        name,
        prompt,
        contextBudget(connection, contextOptions.budgetTokens),
      );
    },
    logs(serverId?: string, limit = 20): McpRuntimeLog[] {
      const count = Math.max(1, limit);
      return entries
        .filter((entry) => serverId === undefined || entry.id === serverId)
        .flatMap((entry) =>
          (entry.connection?.logs ?? []).slice(-count).map((message) => ({
            server: entry.id,
            message,
          })),
        )
        .slice(-count);
    },
    async close(): Promise<void> {
      open = false;
      for (const entry of entries) {
        broker.cancelServer(entry.id);
        if (entry.connection === undefined) continue;
        await closeConnection(entry.connection);
      }
      if (ownsBroker) broker.close();
    },
  };

  rebuild();
  return runtime;
}
